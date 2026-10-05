import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { RecordWriteRulesPreQueryHook } from 'src/modules/record-rules/query-hooks/record-write-rules.pre-query.hook';
import { RecordRuleCheckService } from 'src/modules/record-rules/services/record-rule-check.service';
import { RecordRulesService } from 'src/modules/record-rules/services/record-rules.service';

/**
 * Хуки правил проверки до записи.
 *
 * Модуль подключается в WorkspaceQueryHookModule — это штатная точка
 * регистрации хуков (там же модули note, task, timeline и другие).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KeyValuePairEntity,
      RoleEntity,
      RoleTargetEntity,
    ]),
    TypeORMModule,
  ],
  providers: [
    provideWorkspaceScopedRepository(RoleEntity),
    provideWorkspaceScopedRepository(RoleTargetEntity),
    RecordRulesService,
    RecordRuleCheckService,
    RecordWriteRulesPreQueryHook,
  ],
  exports: [RecordRulesService, RecordRuleCheckService],
})
export class RecordRulesQueryHookModule {}
