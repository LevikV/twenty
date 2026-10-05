import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
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
 * Этапы: 1.1 — каркас, 1.2 — чтение правил из kv и кэш.
 * Проверка значения — этап 1.3.
 */
@WorkspaceQueryHook('*.updateOne')
export class RecordWriteRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
  constructor(private readonly recordRulesService: RecordRulesService) {}

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

    // Этап 1.3 — проверка значения по правилу. Пока ничего не меняем.
    return payload;
  }
}
