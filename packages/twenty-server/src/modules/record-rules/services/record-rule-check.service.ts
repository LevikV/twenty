import { Injectable, Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type RecordRule } from 'src/modules/record-rules/types/record-rule.type';

/**
 * Кто действует: роли пользователя, признак администратора и связанный
 * сотрудник. Кэшируется, потому что читается на каждое изменение записи.
 */
export const RECORD_RULES_ACTING_USER_CACHE_TTL_MS = 15_000;

type ActingUser = {
  roleLabels: string[];
  isAdministrator: boolean;
  sotrudnikId: string | null;
};

export type RecordRuleViolation = {
  rule: RecordRule;
  attemptedValue: string;
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
  ) {}

  /**
   * Первое нарушение правил для операции updateOne или null, если всё чисто.
   *
   * Логика (решения этапа 0):
   * - администраторы правило обходят;
   * - правило действует, только если заполнено «кому» (сотрудник — приоритетно) ;
   * - проверяем лишь те правила, чьё поле реально меняется;
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
    const workspaceId = authContext.workspace.id;
    const actingUser = await this.getActingUser(
      workspaceId,
      authContext.userWorkspaceId,
      authContext.workspaceMemberId,
    );

    if (actingUser.isAdministrator) {
      return null;
    }

    await this.warnAboutMissingRoles(workspaceId, rules);

    for (const rule of rules) {
      if (!this.ruleTargetsUser(rule, actingUser)) {
        continue;
      }

      const rawValue = data[rule.fieldName];

      if (!isDefined(rawValue)) {
        continue;
      }

      const attemptedValue = String(rawValue);

      if (!rule.allowedValues.includes(attemptedValue)) {
        return { rule, attemptedValue };
      }

      if (!rule.onlyFromSet) {
        continue;
      }

      const current = await this.readFieldValue({
        objectName,
        recordId,
        fieldName: rule.fieldName,
      });

      // Не смогли прочитать — не блокируем (fail-safe, ошибка уже в логе).
      if (!current.isReadable) {
        continue;
      }

      if (current.value === null || !rule.allowedValues.includes(current.value)) {
        return { rule, attemptedValue };
      }
    }

    return null;
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
    workspaceId: string,
    userWorkspaceId: string,
    workspaceMemberId: string,
  ): Promise<ActingUser> {
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
      sotrudnikId: await this.readSotrudnikId(workspaceId, workspaceMemberId),
    };

    this.actingUserCache.set(cacheKey, {
      user,
      expiresAt: Date.now() + RECORD_RULES_ACTING_USER_CACHE_TTL_MS,
    });

    return user;
  }

  /** Сотрудник, привязанный к участнику воркспейса (правило может быть на него). */
  private async readSotrudnikId(
    workspaceId: string,
    workspaceMemberId: string,
  ): Promise<string | null> {
    try {
      const repository = this.workspaceOrmManager.getRepository(
        'workspaceMember',
        { shouldBypassPermissionChecks: true },
        { useReplica: true },
      );
      const member = (await repository.findOne({
        where: { id: workspaceMemberId },
      })) as { sotrudnikId?: string | null } | null;

      return member?.sotrudnikId ?? null;
    } catch (error) {
      this.logger.warn(
        `record-rules: не удалось прочитать участника ${workspaceMemberId} воркспейса ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  private async readFieldValue({
    objectName,
    recordId,
    fieldName,
  }: {
    objectName: string;
    recordId: string;
    fieldName: string;
  }): Promise<{ isReadable: boolean; value: string | null }> {
    try {
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
