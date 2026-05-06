// Phase 4a — typed errors. Used by cred-gate "real client" stubs to fail loud
// when someone explicitly opts in (sets *_REAL_CLIENT_READY=true) before the
// real client is actually wired up.

export class NotImplementedError extends Error {
  constructor(public readonly feature: string) {
    super(`[not-implemented] ${feature}: real client lands post-launch`);
    this.name = 'NotImplementedError';
  }
}
