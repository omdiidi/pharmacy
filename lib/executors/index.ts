// Executor registry. Keyed by `kind` (the executor taxonomy field on
// briefings.proposed_actions[].kind). Approve/undo routes resolve through here.

import { listOnAmazon } from './list-on-amazon';
import { type Executor, UnknownExecutorError } from './types';

const registry: Record<string, Executor> = {
  list_on_amazon: listOnAmazon,
  // Future Layer 3 executors plug in here: reprice, pause_listing, fulfill_order, etc.
};

export function getExecutor(kind: string): Executor {
  const ex = registry[kind];
  if (!ex) throw new UnknownExecutorError(kind);
  return ex;
}

export type { Executor, ExecutorContext, ExecutorResult } from './types';
export { UnknownExecutorError } from './types';
