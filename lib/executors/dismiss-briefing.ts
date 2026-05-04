// dismiss_briefing executor — no-op handler.
// The listing agent emits a "Skip" pseudo-action with kind='dismiss_briefing'
// (see lib/agents/listing-agent.ts), but no executor was registered, so clicking
// Skip would 500 out of getExecutor(kind). This thin no-op closes the loop:
// approve flow records the action, the inbox row transitions to 'acted', the
// 30-min undo banner appears, and undo restores nothing material.

import type { Executor } from './types';

export const dismissBriefing: Executor = {
  kind: 'dismiss_briefing',
  async forward() {
    return { dismissed: true };
  },
  async reverse() {
    return { restored: true };
  },
};
