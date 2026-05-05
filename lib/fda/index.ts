// Public surface for the openFDA facade. Real-only; no fixture path because
// openFDA is keyless and free. Callers (Research Analyst) wrap calls with
// per-call try/catch; on 5xx the helpers above degrade to empty arrays.

export { getActiveOtcShortages } from './shortage';
export { getRecentDrugRecalls } from './recall';
export type { FdaShortageRecord, FdaRecallRecord, FdaResponse } from './types';
