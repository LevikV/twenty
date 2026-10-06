/**
 * Типы правил проверки до записи (серверная часть).
 *
 * Зеркало схемы приложения `apps/record-rules` (монорепо LevikV/twenty-apps):
 * правила лежат одной записью kv с ключом `record-rules:config`. Приложение
 * и ядро читают одну и ту же запись, поэтому состав полей должен совпадать.
 */

export const RECORD_RULES_KV_KEY = 'record-rules:config';

export type RecordRuleAction = 'CREATE' | 'UPDATE' | 'BOTH';

export type RecordRule = {
  id: string;
  objectName: string;
  fieldName: string;
  action: RecordRuleAction;
  roleName: string | null;
  sotrudnikId: string | null;
  allowedValues: string[];
  onlyFromSet: boolean;
  message: string;
  active: boolean;
  applyToServiceChanges: boolean;

  /**
   * Заморозка записи (Задача 3): пока запись в закрытой стадии, адресованному
   * пользователю запрещены любые правки записи, кроме `freezeAllowedFields`.
   * Пустой `freezeValues` означает «закрыто всё, чего нет в `allowedValues`».
   */
  freezeEnabled: boolean;
  freezeValues: string[];
  freezeAllowedFields: string[];
  freezeMessage: string;
};

export type RecordRulesConfig = {
  rules: RecordRule[];
};
