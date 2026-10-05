import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type UpdateOneResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

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
 * Этап 1.1 — только каркас: быстрый выход, поведение системы не меняется.
 * Чтение правил и проверка значения — этапы 1.2–1.4.
 */
@WorkspaceQueryHook('*.updateOne')
export class RecordWriteRulesPreQueryHook
  implements WorkspacePreQueryHookInstance
{
  async execute(
    _authContext: WorkspaceAuthContext,
    _objectName: string,
    payload: UpdateOneResolverArgs,
  ): Promise<UpdateOneResolverArgs> {
    // Быстрый выход: пока правил нет — пропускаем запись без изменений.
    return payload;
  }
}
