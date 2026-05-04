// Executor registry. Keyed by `kind` (the executor taxonomy field on
// briefings.proposed_actions[].kind). Approve/undo routes resolve through here.

import { listOnAmazon } from './list-on-amazon';
import { addToWatchlist } from './add-to-watchlist';
import { pauseBrand } from './pause-brand';
import { flagAnomaly } from './flag-anomaly';
import { dismissBriefing } from './dismiss-briefing';
import { type Executor, UnknownExecutorError } from './types';

const registry: Record<string, Executor> = {
  list_on_amazon: listOnAmazon,
  add_to_watchlist: addToWatchlist,
  pause_brand: pauseBrand,
  flag_anomaly: flagAnomaly,
  dismiss_briefing: dismissBriefing,
};

export function getExecutor(kind: string): Executor {
  const ex = registry[kind];
  if (!ex) throw new UnknownExecutorError(kind);
  return ex;
}

export type { Executor, ExecutorContext, ExecutorResult } from './types';
export { UnknownExecutorError } from './types';
