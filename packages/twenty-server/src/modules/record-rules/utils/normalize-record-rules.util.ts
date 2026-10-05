import {
  type RecordRule,
  type RecordRuleAction,
  type RecordRulesConfig,
} from 'src/modules/record-rules/types/record-rule.type';

/**
 * Нормализация конфигурации правил, пришедшей из kv.
 *
 * Задача — не доверять содержимому хранилища: битый JSON, чужие типы,
 * отсутствующие поля не должны ломать запись (fail-safe: непонятное
 * правило отбрасываем, остальные работают).
 */

const isRecordRuleAction = (value: unknown): value is RecordRuleAction =>
  value === 'CREATE' || value === 'UPDATE' || value === 'BOTH';

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asNullableTrimmedString = (value: unknown): string | null => {
  const text = asTrimmedString(value);

  return text.length > 0 ? text : null;
};

const asBooleanOrDefault = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asAllowedValues = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  for (const item of value) {
    const text = asTrimmedString(item);

    if (text.length === 0) {
      continue;
    }

    seen.add(text);
  }

  return [...seen];
};

const normalizeRule = (raw: unknown): RecordRule | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const candidate = raw as Partial<RecordRule>;
  const id = asTrimmedString(candidate.id);

  // Правило без идентификатора бесполезно (нельзя ни сослаться, ни выключить).
  if (id.length === 0) {
    return null;
  }

  return {
    id,
    objectName: asTrimmedString(candidate.objectName),
    fieldName: asTrimmedString(candidate.fieldName),
    action: isRecordRuleAction(candidate.action) ? candidate.action : 'UPDATE',
    roleName: asNullableTrimmedString(candidate.roleName),
    sotrudnikId: asNullableTrimmedString(candidate.sotrudnikId),
    allowedValues: asAllowedValues(candidate.allowedValues),
    onlyFromSet: asBooleanOrDefault(candidate.onlyFromSet, true),
    message: asTrimmedString(candidate.message),
    active: asBooleanOrDefault(candidate.active, true),
    applyToServiceChanges: asBooleanOrDefault(
      candidate.applyToServiceChanges,
      false,
    ),
  };
};

export const normalizeRecordRulesConfig = (raw: unknown): RecordRulesConfig => {
  if (typeof raw !== 'object' || raw === null) {
    return { rules: [] };
  }

  const maybeRules = (raw as { rules?: unknown }).rules;

  if (!Array.isArray(maybeRules)) {
    return { rules: [] };
  }

  return {
    rules: maybeRules
      .map(normalizeRule)
      .filter((rule): rule is RecordRule => rule !== null),
  };
};

/**
 * Пригодно ли правило к работе (для быстрого выхода): активно, заданы объект,
 * поле и хотя бы одно разрешённое значение.
 */
export const isUsableRule = (rule: RecordRule): boolean =>
  rule.active &&
  rule.objectName.length > 0 &&
  rule.fieldName.length > 0 &&
  rule.allowedValues.length > 0;
