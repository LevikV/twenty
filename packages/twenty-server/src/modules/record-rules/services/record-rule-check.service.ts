import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type RecordRule } from 'src/modules/record-rules/types/record-rule.type';
import { buildRecordRuleMessage } from 'src/modules/record-rules/utils/build-record-rule-message.util';

/**
 * Кто действует: роли пользователя, признак администратора и связанный
 * сотрудник. Кэшируется, потому что читается на каждое изменение записи.
 */
export const RECORD_RULES_ACTING_USER_CACHE_TTL_MS = 15_000;

/** Подпись для массовой правки, когда значение задано фильтром, а не строкой. */
const BULK_VALUE_LABEL = 'несколько записей';

type ActingUser = {
  roleLabels: string[];
  isAdministrator: boolean;
  sotrudnikId: string | null;
};

type CheckContext = {
  workspaceId: string;
  actingUser: ActingUser;
};

export type RecordRuleViolation = {
  rule: RecordRule;
  attemptedValue: string;
  /** Готовый текст для пользователя (шаблон правила + подпись значения). */
  message: string;
};

@Injectable()
export class RecordRuleCheckService {
  private readonly logger = new Logger(RecordRuleCheckService.name);
  private readonly actingUserCache = new Map<
    string,
    { user: ActingUser; expiresAt: number }
  >();
  private readonly workspaceRolesCache = new Map<
    string,
    { labels: string[]; expiresAt: number }
  >();
  private readonly warnedMissingRoles = new Set<string>();

  constructor(
    private readonly workspaceOrmManager: WorkspaceOrmManager,
    @InjectWorkspaceScopedRepository(RoleEntity)
    private readonly roleRepository: WorkspaceScopedRepository<RoleEntity>,
    @InjectWorkspaceScopedRepository(RoleTargetEntity)
    private readonly roleTargetRepository: WorkspaceScopedRepository<RoleTargetEntity>,
    @InjectWorkspaceScopedRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: WorkspaceScopedRepository<ObjectMetadataEntity>,
    @InjectWorkspaceScopedRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: WorkspaceScopedRepository<FieldMetadataEntity>,
  ) {}

  /**
   * Нарушение при изменении одной записи (updateOne) или null, если чисто.
   *
   * - правило действует, только если заполнено «кому» (сотрудник важнее роли);
   * - проверяются лишь правила, чьё поле реально меняется;
   * - политика «разрешено только перечисленное»: новое значение вне списка — отказ;
   * - «только внутри набора»: текущее значение тоже должно быть в списке.
   */
  async findUpdateViolation({
    authContext,
    rules,
    objectName,
    recordId,
    data,
  }: {
    authContext: UserWorkspaceAuthContext;
    rules: RecordRule[];
    objectName: string;
    recordId: string;
    data: Record<string, unknown>;
  }): Promise<RecordRuleViolation | null> {
    const context = await this.getCheckContext(authContext, rules);

    if (!isDefined(context)) {
      return null;
    }

    for (const rule of rules) {
      if (rule.action === 'CREATE') {
        continue;
      }

      if (!this.ruleTargetsUser(rule, context.actingUser)) {
        continue;
      }

      const rawValue = data[rule.fieldName];

      if (!isDefined(rawValue)) {
        continue;
      }

      const attemptedValue = String(rawValue);

      if (!rule.allowedValues.includes(attemptedValue)) {
        return await this.buildViolation(
          context.workspaceId,
          objectName,
          rule,
          attemptedValue,
        );
      }

      if (!rule.onlyFromSet) {
        continue;
      }

      const current = await this.readFieldValue({
        authContext,
        objectName,
        recordId,
        fieldName: rule.fieldName,
      });

      // Не смогли прочитать — не блокируем (fail-safe, ошибка уже в логе).
      if (!current.isReadable) {
        continue;
      }

      if (current.value === null || !rule.allowedValues.includes(current.value)) {
        return await this.buildViolation(
          context.workspaceId,
          objectName,
          rule,
          attemptedValue,
        );
      }
    }

    return null;
  }

  /**
   * Нарушение при создании записей (createOne / createMany, в том числе
   * импорт CSV) или null, если чисто.
   *
   * Условие «только внутри набора» к созданию неприменимо: проверяем только
   * то значение, которое ставят.
   */
  async findCreateViolation({
    authContext,
    rules,
    objectName,
    dataItems,
  }: {
    authContext: UserWorkspaceAuthContext;
    rules: RecordRule[];
    objectName: string;
    dataItems: Record<string, unknown>[];
  }): Promise<RecordRuleViolation | null> {
    const context = await this.getCheckContext(authContext, rules);

    if (!isDefined(context)) {
      return null;
    }

    for (const rule of rules) {
      if (rule.action === 'UPDATE') {
        continue;
      }

      if (!this.ruleTargetsUser(rule, context.actingUser)) {
        continue;
      }

      for (const data of dataItems) {
        const rawValue = data?.[rule.fieldName];

        if (!isDefined(rawValue)) {
          continue;
        }

        const attemptedValue = String(rawValue);

        if (!rule.allowedValues.includes(attemptedValue)) {
          return await this.buildViolation(
            context.workspaceId,
            objectName,
            rule,
            attemptedValue,
          );
        }
      }
    }

    return null;
  }

  /**
   * Нарушение при массовой правке (updateMany).
   *
   * Решение 8 этапа 0: массовое изменение такого поля недоступно вовсе —
   * значение не разбираем, отказ при самом факте правки поля.
   */
  async findBulkUpdateViolation({
    authContext,
    rules,
    objectName,
    data,
  }: {
    authContext: UserWorkspaceAuthContext;
    rules: RecordRule[];
    objectName: string;
    data: Record<string, unknown>;
  }): Promise<RecordRuleViolation | null> {
    const context = await this.getCheckContext(authContext, rules);

    if (!isDefined(context)) {
      return null;
    }

    for (const rule of rules) {
      if (rule.action === 'CREATE') {
        continue;
      }

      if (!this.ruleTargetsUser(rule, context.actingUser)) {
        continue;
      }

      const rawValue = data[rule.fieldName];

      if (!isDefined(rawValue)) {
        continue;
      }

      if (typeof rawValue === 'string') {
        return await this.buildViolation(
          context.workspaceId,
          objectName,
          rule,
          rawValue,
        );
      }

      return await this.buildViolation(
        context.workspaceId,
        objectName,
        rule,
        BULK_VALUE_LABEL,
        BULK_VALUE_LABEL,
      );
    }

    return null;
  }

  /**
   * Общая часть: администраторы правило обходят, отсутствующие роли
   * предупреждаются в лог. null — проверять нечего.
   */
  private async getCheckContext(
    authContext: UserWorkspaceAuthContext,
    rules: RecordRule[],
  ): Promise<CheckContext | null> {
    const workspaceId = authContext.workspace.id;
    const actingUser = await this.getActingUser(
      authContext,
      authContext.userWorkspaceId,
      authContext.workspaceMemberId,
    );

    if (actingUser.isAdministrator) {
      return null;
    }

    await this.warnAboutMissingRoles(workspaceId, rules);

    return { workspaceId, actingUser };
  }

  /** Готовое нарушение с текстом для пользователя. */
  private async buildViolation(
    workspaceId: string,
    objectName: string,
    rule: RecordRule,
    attemptedValue: string,
    valueLabelOverride?: string,
  ): Promise<RecordRuleViolation> {
    const valueLabel =
      valueLabelOverride ??
      (await this.resolveValueLabel({
        workspaceId,
        objectName,
        fieldName: rule.fieldName,
        value: attemptedValue,
      }));

    return {
      rule,
      attemptedValue,
      message: buildRecordRuleMessage(rule.message, valueLabel),
    };
  }

  /**
   * Подпись значения по опциям поля («Выдан», а не `VYDAN`).
   * Не получилось — возвращаем само значение: текст отказа важнее точности.
   */
  private async resolveValueLabel({
    workspaceId,
    objectName,
    fieldName,
    value,
  }: {
    workspaceId: string;
    objectName: string;
    fieldName: string;
    value: string;
  }): Promise<string> {
    try {
      const objectMetadata = await this.objectMetadataRepository.findOne(
        workspaceId,
        { where: { nameSingular: objectName } },
      );

      if (!isDefined(objectMetadata)) {
        return value;
      }

      const fieldMetadata = await this.fieldMetadataRepository.findOne(
        workspaceId,
        { where: { name: fieldName, objectMetadataId: objectMetadata.id } },
      );

      if (!isDefined(fieldMetadata) || !Array.isArray(fieldMetadata.options)) {
        return value;
      }

      const option = (
        fieldMetadata.options as { value?: unknown; label?: unknown }[]
      ).find((fieldOption) => fieldOption?.value === value);
      const label = option?.label;

      return typeof label === 'string' && label.length > 0 ? label : value;
    } catch (error) {
      this.logger.warn(
        `record-rules: не удалось получить подпись значения «${value}» для ${objectName}.${fieldName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return value;
    }
  }

  /** Правило адресовано этому пользователю? Сотрудник важнее роли. */
  private ruleTargetsUser(rule: RecordRule, actingUser: ActingUser): boolean {
    if (isDefined(rule.sotrudnikId)) {
      return (
        isDefined(actingUser.sotrudnikId) &&
        actingUser.sotrudnikId === rule.sotrudnikId
      );
    }

    if (isDefined(rule.roleName)) {
      return actingUser.roleLabels.includes(rule.roleName);
    }

    // Правило без «кому» не действует ни на кого.
    return false;
  }

  private async getActingUser(
    authContext: UserWorkspaceAuthContext,
    userWorkspaceId: string,
    workspaceMemberId: string,
  ): Promise<ActingUser> {
    const workspaceId = authContext.workspace.id;
    const cacheKey = `${workspaceId}:${userWorkspaceId}:${workspaceMemberId}`;
    const cached = this.actingUserCache.get(cacheKey);

    if (isDefined(cached) && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const roleTargets = await this.roleTargetRepository.find(workspaceId, {
      where: { userWorkspaceId },
    });
    const roleIds = roleTargets.map((roleTarget) => roleTarget.roleId);
    const roles = roleIds.length
      ? await this.roleRepository.find(workspaceId, { where: { id: In(roleIds) } })
      : [];

    const user: ActingUser = {
      roleLabels: roles.map((role) => role.label),
      isAdministrator: roles.some((role) => role.canUpdateAllSettings),
      sotrudnikId: await this.readSotrudnikId(authContext, workspaceMemberId),
    };

    this.actingUserCache.set(cacheKey, {
      user,
      expiresAt: Date.now() + RECORD_RULES_ACTING_USER_CACHE_TTL_MS,
    });

    return user;
  }

  /**
   * Сотрудник, привязанный к участнику воркспейса (правило может быть на него).
   *
   * ⚠️ Внутри pre-query хука нет контекста воркспейса: без
   * `executeInWorkspaceContext` чтение падает с «Workspace context not set»
   * (проверено на живом прогоне 06.10.2026 — правило не срабатывало).
   * Так же это делает ядро в `TaskPostQueryHookService`.
   */
  private async readSotrudnikId(
    authContext: UserWorkspaceAuthContext,
    workspaceMemberId: string,
  ): Promise<string | null> {
    try {
      return await this.workspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository = this.workspaceOrmManager.getRepository(
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
            { useReplica: true },
          );
          const member = (await repository.findOne({
            where: { id: workspaceMemberId },
          })) as { sotrudnikId?: string | null } | null;

          return member?.sotrudnikId ?? null;
        },
        authContext,
      );
    } catch (error) {
      this.logger.warn(
        `record-rules: не удалось прочитать участника ${workspaceMemberId} воркспейса ${authContext.workspace.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  private async readFieldValue({
    authContext,
    objectName,
    recordId,
    fieldName,
  }: {
    authContext: UserWorkspaceAuthContext;
    objectName: string;
    recordId: string;
    fieldName: string;
  }): Promise<{ isReadable: boolean; value: string | null }> {
    try {
      return await this.workspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository = this.workspaceOrmManager.getRepository(
            objectName,
            { shouldBypassPermissionChecks: true },
            { useReplica: true },
          );
          const record = (await repository.findOne({
            where: { id: recordId },
          })) as Record<string, unknown> | null;

          if (!isDefined(record)) {
            return { isReadable: false, value: null };
          }

          const value = record[fieldName];

          return {
            isReadable: true,
            value: isDefined(value) ? String(value) : null,
          };
        },
        authContext,
      );
    } catch (error) {
      this.logger.warn(
        `record-rules: не удалось прочитать ${objectName}.${fieldName} записи ${recordId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { isReadable: false, value: null };
    }
  }

  /**
   * Роль в правиле задана названием. Если такого названия в воркспейсе нет
   * (роль переименовали или удалили) — правило молча не сработает, поэтому
   * пишем предупреждение (один раз на роль).
   */
  private async warnAboutMissingRoles(
    workspaceId: string,
    rules: RecordRule[],
  ): Promise<void> {
    const roleNames = rules
      .map((rule) => rule.roleName)
      .filter((roleName): roleName is string => isDefined(roleName));

    if (roleNames.length === 0) {
      return;
    }

    const labels = await this.getWorkspaceRoleLabels(workspaceId);

    for (const roleName of roleNames) {
      if (labels.includes(roleName)) {
        continue;
      }

      const warnKey = `${workspaceId}:${roleName}`;

      if (this.warnedMissingRoles.has(warnKey)) {
        continue;
      }

      this.warnedMissingRoles.add(warnKey);
      this.logger.warn(
        `record-rules: в воркспейсе ${workspaceId} нет роли «${roleName}» — правило не сработает`,
      );
    }
  }

  private async getWorkspaceRoleLabels(workspaceId: string): Promise<string[]> {
    const cached = this.workspaceRolesCache.get(workspaceId);

    if (isDefined(cached) && cached.expiresAt > Date.now()) {
      return cached.labels;
    }

    const roles = await this.roleRepository.find(workspaceId);
    const labels = roles.map((role) => role.label);

    this.workspaceRolesCache.set(workspaceId, {
      labels,
      expiresAt: Date.now() + RECORD_RULES_ACTING_USER_CACHE_TTL_MS,
    });

    return labels;
  }
}
