/**
 * Текст отказа для пользователя.
 *
 * Правило хранит шаблон вида «Стадию «{название}» может поставить только
 * менеджер»; `{название}` заменяется подписью значения, которое пытались
 * поставить (например «Выдан», а не `VYDAN`).
 */
export const DEFAULT_RECORD_RULE_MESSAGE =
  'Стадию «{название}» может поставить только менеджер';

export const DEFAULT_RECORD_RULE_FREEZE_MESSAGE =
  'Запись в стадии «{название}» закрыта для правки';

export const DEFAULT_RECORD_RULE_BULK_FREEZE_MESSAGE =
  'Массовая правка записей в закрытой стадии запрещена';

export const buildRecordRuleMessage = (
  template: string,
  valueLabel: string,
  defaultTemplate: string = DEFAULT_RECORD_RULE_MESSAGE,
): string => {
  const normalizedTemplate = template.trim();

  return (normalizedTemplate.length > 0
    ? normalizedTemplate
    : defaultTemplate
  ).replaceAll('{название}', valueLabel);
};
