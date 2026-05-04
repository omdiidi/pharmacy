// Fixture loader. Reads vendor/sp-api-fixtures/<operationId>.json and returns
// the body of the first example. Synchronous + cached because fixtures are
// small (<10kb each) and read often during development.

import { readFileSync } from 'node:fs';
import path from 'node:path';

type SandboxFixture<T> = { examples: Array<{ response: { body: T } }> };

const cache = new Map<string, unknown>();

export function loadFixture<T>(operationId: string): T {
  const cached = cache.get(operationId);
  if (cached) return cached as T;
  const p = path.resolve(process.cwd(), 'vendor/sp-api-fixtures', `${operationId}.json`);
  const raw = JSON.parse(readFileSync(p, 'utf8')) as SandboxFixture<T>;
  if (!raw.examples || raw.examples.length === 0) {
    throw new Error(`loadFixture: no examples in ${p}`);
  }
  const body = raw.examples[0].response.body;
  cache.set(operationId, body);
  return body;
}

// Loads a raw JSON file directly (no examples wrapping). Used for the
// synthesized seller-performance report and notification envelopes.
export function loadRawFixture<T>(filename: string): T {
  const cached = cache.get(`raw:${filename}`);
  if (cached) return cached as T;
  const p = path.resolve(process.cwd(), 'vendor/sp-api-fixtures', filename);
  const data = JSON.parse(readFileSync(p, 'utf8')) as T;
  cache.set(`raw:${filename}`, data);
  return data;
}
