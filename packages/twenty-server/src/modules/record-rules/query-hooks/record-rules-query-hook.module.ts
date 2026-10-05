import { Module } from '@nestjs/common';

import { RecordWriteRulesPreQueryHook } from 'src/modules/record-rules/query-hooks/record-write-rules.pre-query.hook';

/**
 * Хуки правил проверки до записи.
 *
 * Модуль подключается в WorkspaceQueryHookModule — это штатная точка
 * регистрации хуков (там же модули note, task, timeline и другие).
 */
@Module({
  providers: [RecordWriteRulesPreQueryHook],
})
export class RecordRulesQueryHookModule {}
