// Pure deterministic classifier for Amazon Account Health metrics.
// Threshold values per the account-health.md skill prompt.

import type { SellerPerformanceSnapshot } from '@/lib/sp-api';

export type HealthMetricsSnapshot = SellerPerformanceSnapshot;
export type HealthStatus = 'green' | 'yellow' | 'red';

export function classifyStatus(s: HealthMetricsSnapshot): HealthStatus {
  const odr: HealthStatus = s.odr >= 0.02 ? 'red' : s.odr >= 0.01 ? 'yellow' : 'green';
  const late: HealthStatus = s.late_ship_rate >= 0.10 ? 'red' : s.late_ship_rate >= 0.04 ? 'yellow' : 'green';
  const cancel: HealthStatus =
    s.cancellation_rate >= 0.05 ? 'red' : s.cancellation_rate >= 0.025 ? 'yellow' : 'green';
  const vtr: HealthStatus = s.vtr < 0.90 ? 'red' : s.vtr < 0.95 ? 'yellow' : 'green';
  const all: HealthStatus[] = [odr, late, cancel, vtr];
  if (all.includes('red')) return 'red';
  if (all.includes('yellow')) return 'yellow';
  return 'green';
}
