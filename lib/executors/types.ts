// Executor framework — kernel for the propose → approve → execute → undo loop.
// Each executor knows how to forward a proposed action and reverse it within
// the 30-min undo window. All Phase 2 executors are stubbed (no SP-API).

export type ExecutorContext = {
  pharmacyId: string;
  userId: string;
};

export type ExecutorResult = Record<string, unknown>;

export interface Executor {
  kind: string;
  forward(params: unknown, ctx: ExecutorContext): Promise<ExecutorResult>;
  reverse(
    params: unknown,
    forwardResult: ExecutorResult,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult>;
}

// Thrown by getExecutor() when no executor is registered for a kind. Caught by
// approve/undo routes to return a 500 with the unknown kind in the message.
export class UnknownExecutorError extends Error {
  constructor(public readonly kind: string) {
    super(`unknown executor kind: ${kind}`);
    this.name = 'UnknownExecutorError';
  }
}
