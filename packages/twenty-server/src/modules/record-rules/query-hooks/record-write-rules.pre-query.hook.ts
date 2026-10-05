import { type MessageDescriptor } from '@lingui/core';

import { isDefined } from 'twenty-shared/utils';

import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { RecordRuleCheckService } from 'src/modules/record-rules/services/record-rule-check.service';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';

export const RECORD_WRITE_RULE_VIOLATION_SUB_CODE = 'RECORD_WRITE_RULE_VIOLATION';

/**
 * Проверка правил ДО записи: универсальный перехватчик изменения записи.
 *
 * Правила хранит приложение «Правила записи» (LevikV/twenty-apps,
 * apps/record-rules) в kv-записи `record-rules:config`. Здесь — точка
 * перехвата в ядре: хук видит, КТО действует (authContext), ЧТО пишется
 * (payload) и прерывает операцию до записи в базу.
 *
 * Отклонённое изменение не попадает в базу вообще — в отличие от «отмены
 * после сохранения», где след остаётся в истории и в updatedAt/updatedBy.
 *
 * ⚠️ Wildcard `*.updateOne` — один класс на метод (декоратор вешает
 * метаданные, поэтому навесить несколько ключей на класс нельзя).
 * Остальные пути записи (updateMany, createOne, createMany) добавляются
 * отдельными тонкими классами — этап 1.5.
 */
@WorkspaceQueryHook('*.updateOne')
export class RecordWriteRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
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

    if (!isDefined(violation)) {
      return payload;
    }

    // Текст показывает фронт как есть (см. get-error-message-from-apollo-error:
    // из extensions.userFriendlyMessage, строка или MessageDescriptor).
    throw new UserInputError('Record write rule violation', {
      userFriendlyMessage: {
        id: 'record-rule-violation',
        message: violation.message,
      } as MessageDescriptor,
      subCode: RECORD_WRITE_RULE_VIOLATION_SUB_CODE,
      isExpected: true,
    });
  }
}
