import { isDefined } from 'twenty-shared/utils';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type UpdateManyResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecordRuleCheckService } from 'src/modules/record-rules/services/record-rule-check.service';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';
import { buildRecordRuleViolationError } from 'src/modules/record-rules/utils/record-rule-violation-error.util';

/**
 * Массовая правка: выделили записи в списке → «Изменить».
 *
 * Решение 8 этапа 0: массовое изменение защищённого поля недоступно вовсе —
 * отказ по самому факту правки поля, значения не разбираются.
 *
 * ⚠️ Один класс = один метод: декоратор вешает метаданные на класс.
 */
@WorkspaceQueryHook('*.updateMany')
export class RecordUpdateManyRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
  constructor(
    private readonly recordRulesService: RecordRulesService,
    private readonly recordRuleCheckService: RecordRuleCheckService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: UpdateManyResolverArgs,
  ): Promise<UpdateManyResolverArgs> {
    if (authContext.type !== 'user') {
      return payload;
    }

    const rules = await this.recordRulesService.getRulesForObject(
      authContext.workspace.id,
      objectName,
    );

    if (rules.length === 0) {
      return payload;
    }

    const violation = await this.recordRuleCheckService.findBulkUpdateViolation({
      authContext,
      rules,
      objectName,
      data: (payload.data ?? {}) as Record<string, unknown>,
    });

    if (!isDefined(violation)) {
      return payload;
    }

    throw buildRecordRuleViolationError(violation);
  }
}
