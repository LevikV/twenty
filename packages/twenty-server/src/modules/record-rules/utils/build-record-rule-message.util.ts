/**
 * Текст отказа для пользователя.
 *
 * Правило хранит шаблон вида «Стадию «{название}» может поставить только
 * менеджер»; `{название}` заменяется подписью значения, которое пытались
 * поставить (например «Выдан», а не `VYDAN`).
 */
export const DEFAULT_RECORD_RULE_MESSAGE =
  'Стадию «{название}» может поставить только менеджер';

export const buildRecordRuleMessage = (
  template: string,
  valueLabel: string,
): string => {
  const normalizedTemplate = template.trim();

  return (normalizedTemplate.length > 0
    ? normalizedTemplate
    : DEFAULT_RECORD_RULE_MESSAGE
  ).replaceAll('{название}', valueLabel);
};
