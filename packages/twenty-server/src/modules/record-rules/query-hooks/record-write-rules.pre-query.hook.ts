import { Logger } from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecordRuleCheckService } from 'src/modules/record-rules/services/record-rule-check.service';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';

/**
 * Проверка правил ДО записи: универсальный перехватчик изменения записи.
 *
 * Правила хранит приложение «Правила записи» (LevikV/twenty-apps,
 * apps/record-rules) в kv-записи `record-rules:config`. Здесь — точка
 * перехвата в ядре: хук видит, КТО действует (authContext), ЧТО пишется
 * (payload) и может прервать операцию до записи в базу.
 *
 * ⚠️ Wildcard `*.updateOne` — один класс на метод (декоратор вешает
 * метаданные, поэтому навесить несколько ключей на класс нельзя).
 * Остальные пути записи (updateMany, createOne, createMany) добавляются
 * отдельными тонкими классами — этап 1.5.
 *
 * Этапы: 1.1 — каркас, 1.2 — чтение правил из kv и кэш, 1.3 — проверка
 * значения. Отказ с понятным текстом — этап 1.4.
 */
@WorkspaceQueryHook('*.updateOne')
export class RecordWriteRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
  private readonly logger = new Logger(RecordWriteRulesPreQueryHook.name);

  constructor(
    private readonly recordRulesService: RecordRulesService,
    private readonly recordRuleCheckService: RecordRuleCheckService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateOneResolverArgs,
  ): Promise<UpdateOneResolverArgs> {
    // Решение этапа 0: правило действует только на изменения от пользователей.
    // Изменения приложений, API-ключей и системных процессов пропускаем.
    if (authContext.type !== 'user') {
      return payload;
    }

    const workspaceId = authContext.workspace.id;

    // Быстрый выход: нет активных правил по этому объекту — нулевая цена
    // для всех остальных записей в системе.
    const rules = await this.recordRulesService.getRulesForObject(
      workspaceId,
      objectName,
    );

    if (rules.length === 0) {
      return payload;
    }

    const violation = await this.recordRuleCheckService.findUpdateViolation({
      authContext,
      rules,
      objectName,
      recordId: payload.id,
      data: (payload.data ?? {}) as Record<string, unknown>,
    });

    if (isDefined(violation)) {
      // Этап 1.4 — здесь будет отказ с текстом из правила. Пока фиксируем
      // нарушение в логе, поведение не меняется.
      this.logger.warn(
        `record-rules: правило ${violation.rule.id} запрещает значение «${violation.attemptedValue}» для ${objectName}.${violation.rule.fieldName} (запись ${payload.id})`,
      );
    }

    return payload;
  }
}
