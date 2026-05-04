// acknowledge_health_alert executor — no-op.
// Account Health emits this as the primary action on a red-status briefing.
// Kaleem's click records "I saw the alert" via audit_log (the kernel writes
// the audit row regardless of executor body). This file exists so getExecutor
// resolves the kind. No data mutation.

import type { Executor } from './types';

export const acknowledgeHealthAlert: Executor = {
  kind: 'acknowledge_health_alert',
  async forward() {
    return { acknowledged: true };
  },
  async reverse() {
    return { restored: true };
  },
};
