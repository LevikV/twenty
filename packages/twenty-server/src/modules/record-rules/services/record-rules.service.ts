import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import {
  RECORD_RULES_KV_KEY,
  type RecordRule,
  type RecordRulesConfig,
} from 'src/modules/record-rules/types/record-rule.type';
import {
  isUsableRule,
  normalizeRecordRulesConfig,
} from 'src/modules/record-rules/utils/normalize-record-rules.util';

/**
 * Кэш конфигурации правил в памяти сервера.
 *
 * Правила меняются редко, а читаются на каждую запись, поэтому держим их
 * в памяти. Инвалидацию по факту записи в kv сделать нельзя: пишет другой
 * процесс (приложение), надёжного события об этом в ядре нет. Поэтому TTL:
 * после правки правила в настройках оно вступает в силу в пределах TTL.
 */
export const RECORD_RULES_CACHE_TTL_MS = 15_000;

type RecordRulesCacheEntry = {
  config: RecordRulesConfig;
  expiresAt: number;
};

@Injectable()
export class RecordRulesService {
  private readonly logger = new Logger(RecordRulesService.name);
  private readonly cache = new Map<string, RecordRulesCacheEntry>();

  constructor(
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
  ) {}

  /**
   * Активные правила конкретного объекта воркспейса.
   * Пустой массив — самый частый случай (правил нет) и повод для быстрого выхода.
   */
  async getRulesForObject(
    workspaceId: string,
    objectName: string,
  ): Promise<RecordRule[]> {
    const config = await this.getConfig(workspaceId);

    return config.rules.filter(
      (rule) => isUsableRule(rule) && rule.objectName === objectName,
    );
  }

  async getConfig(workspaceId: string): Promise<RecordRulesConfig> {
    const cached = this.cache.get(workspaceId);

    if (isDefined(cached) && cached.expiresAt > Date.now()) {
      return cached.config;
    }

    const config = await this.readConfig(workspaceId);

    this.cache.set(workspaceId, {
      config,
      expiresAt: Date.now() + RECORD_RULES_CACHE_TTL_MS,
    });

    return config;
  }

  /** Сбросить кэш воркспейса (например, после правки правил из ядра). */
  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }

  private async readConfig(workspaceId: string): Promise<RecordRulesConfig> {
    try {
      // applicationId намеренно не фильтруем: идентификатор приложения
      // «Правила записи» различается на каждой установке, а ключ уникален.
      const entry = await this.keyValuePairRepository.findOne({
        where: {
          key: RECORD_RULES_KV_KEY,
          workspaceId,
          type: KeyValuePairType.APPLICATION_VARIABLE,
        },
      });

      if (!isDefined(entry)) {
        return { rules: [] };
      }

      const rawValue =
        typeof entry.value === 'string'
          ? (JSON.parse(entry.value) as unknown)
          : entry.value;

      return normalizeRecordRulesConfig(rawValue);
    } catch (error) {
      // Fail-safe: правила не прочитались — не блокируем запись.
      this.logger.warn(
        `record-rules: не удалось прочитать правила воркспейса ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { rules: [] };
    }
  }
}
