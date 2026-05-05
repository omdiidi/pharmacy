// One-shot Keepa /token probe. With KEEPA_API_KEY set: hits real /token.
// Without: returns the fixture payload. Either way prints
// {tokensLeft, refillRate}.
//
// Local: npm run keepa:token

import { getKeepaClient, keepaCredsPresent } from '@/lib/keepa';

async function main() {
  const mode = keepaCredsPresent() ? 'real' : 'fixture';
  console.log(`[keepa-token] mode=${mode}`);
  const client = getKeepaClient();
  const t = await client.getTokenStatus();
  console.log(
    `[keepa-token] tokensLeft=${t.tokensLeft} refillRate=${t.refillRate} refillIn=${t.refillIn}`,
  );
}

main().catch((err) => {
  console.error('[keepa-token] fatal:', err);
  process.exit(1);
});
