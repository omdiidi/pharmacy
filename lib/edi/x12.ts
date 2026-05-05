// Thin wrap around node-x12. Exposes the parser + a query helper used by
// the 832/856 parsers below.

import {
  X12Parser,
  X12QueryEngine,
  type X12Interchange,
  type X12QueryResult,
} from 'node-x12';

export function parseInterchange(edi: string): X12Interchange {
  const parser = new X12Parser(true);
  const result = parser.parse(edi);
  // The parse() return type is X12Interchange | X12FatInterchange. For our
  // single-interchange envelopes the runtime value is always X12Interchange.
  return result as X12Interchange;
}

export function queryAll(
  source: string | X12Interchange,
  ref: string,
): X12QueryResult[] {
  const engine = new X12QueryEngine(true);
  return engine.query(source, ref);
}
