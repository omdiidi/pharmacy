import Anthropic from '@anthropic-ai/sdk';

const REQUIRED_MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  const available: string[] = [];
  for await (const model of client.models.list()) {
    available.push(model.id);
  }

  const missing = REQUIRED_MODELS.filter((id) => !available.includes(id));

  if (missing.length > 0) {
    console.error('Missing required models:');
    for (const id of missing) console.error(`  - ${id}`);
    console.error('\nAvailable models:');
    for (const id of available) console.error(`  - ${id}`);
    process.exit(1);
  }

  console.log('All required models available:');
  for (const id of REQUIRED_MODELS) console.log(`  ok  ${id}`);
  console.log(`\nTotal models visible to this key: ${available.length}`);
  for (const id of available) console.log(`  - ${id}`);
}

main().catch((err) => {
  console.error('verify-models failed:', err);
  process.exit(1);
});
