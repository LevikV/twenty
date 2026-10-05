import { type MessageDescriptor } from '@lingui/core';

import { UserInputError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { type RecordRuleViolation } from 'src/modules/record-rules/services/record-rule-check.service';

/** По этому коду в логах видно, что сработало именно правило, а не что-то другое. */
export const RECORD_WRITE_RULE_VIOLATION_SUB_CODE = 'RECORD_WRITE_RULE_VIOLATION';

/**
 * Отказ в записи.
 *
 * `userFriendlyMessage` показывает фронт как есть (см.
 * `get-error-message-from-apollo-error.util.ts`: принимает строку или
 * `MessageDescriptor`); тип на сервере строку не пропускает, поэтому
 * дескриптор собирается вручную.
 */
export const buildRecordRuleViolationError = (
  violation: RecordRuleViolation,
): UserInputError =>
  new UserInputError('Record write rule violation', {
    userFriendlyMessage: {
      id: 'record-rule-violation',
      message: violation.message,
    } as MessageDescriptor,
    subCode: RECORD_WRITE_RULE_VIOLATION_SUB_CODE,
    isExpected: true,
  });
