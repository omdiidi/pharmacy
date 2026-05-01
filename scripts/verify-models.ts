// Pings OpenRouter and verifies the configured model slugs are reachable.
// Run via: npm run verify-models

const REQUIRED_MODELS = [
  'anthropic/claude-sonnet-4.6',
  'x-ai/grok-4.3',
];

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`OpenRouter /models returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = (await res.json()) as { data: Array<{ id: string }> };
  const available = new Set(body.data.map((m) => m.id));

  const missing = REQUIRED_MODELS.filter((id) => !available.has(id));
  if (missing.length > 0) {
    console.error('Missing required OpenRouter models:');
    for (const id of missing) console.error(`  - ${id}`);
    console.error('\nFix: update lib/llm.ts CHATBOT_MODEL or minicrew-config/config.yaml model slugs.');
    process.exit(1);
  }

  console.log('All required models available on OpenRouter:');
  for (const id of REQUIRED_MODELS) console.log(`  ok  ${id}`);
}

main().catch((err) => {
  console.error('verify-models failed:', err);
  process.exit(1);
});
