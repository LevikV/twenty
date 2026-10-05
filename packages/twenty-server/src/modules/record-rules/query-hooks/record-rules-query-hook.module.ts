import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { RecordWriteRulesPreQueryHook } from 'src/modules/record-rules/query-hooks/record-write-rules.pre-query.hook';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';

/**
 * Хуки правил проверки до записи.
 *
 * Модуль подключается в WorkspaceQueryHookModule — это штатная точка
 * регистрации хуков (там же модули note, task, timeline и другие).
 */
@Module({
  imports: [TypeOrmModule.forFeature([KeyValuePairEntity]), TypeORMModule],
  providers: [RecordRulesService, RecordWriteRulesPreQueryHook],
  exports: [RecordRulesService],
})
export class RecordRulesQueryHookModule {}
