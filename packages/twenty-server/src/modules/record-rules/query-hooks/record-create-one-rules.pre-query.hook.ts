import { isDefined } from 'twenty-shared/utils';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CreateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { RecordRuleCheckService } from 'src/modules/record-rules/services/record-rule-check.service';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';
import { buildRecordRuleViolationError } from 'src/modules/record-rules/utils/record-rule-violation-error.util';

/**
 * Создание одной записи.
 *
 * ⚠️ Один класс = один метод: декоратор вешает метаданные на класс.
 */
@WorkspaceQueryHook('*.createOne')
export class RecordCreateRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
  constructor(
    private readonly recordRulesService: RecordRulesService,
    private readonly recordRuleCheckService: RecordRuleCheckService,
  ) {}

  async execute(
    authContext: WorkspaceAuthContext,
    objectName: string,
    payload: CreateOneResolverArgs,
  ): Promise<CreateOneResolverArgs> {
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

    const violation = await this.recordRuleCheckService.findCreateViolation({
      authContext,
      rules,
      objectName,
      dataItems: [(payload.data ?? {}) as Record<string, unknown>],
    });

    if (!isDefined(violation)) {
      return payload;
    }

    throw buildRecordRuleViolationError(violation);
  }
}
