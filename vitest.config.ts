// Tests run inside workerd via the Cloudflare Vitest pool — the same runtime
// the Worker lives in, reading the same wrangler.jsonc, against real D1 and
// real KV. The session DO joins the suite when it lands (docs/TODO.md § 4).
//
// Migrations are read here and applied per test file by test/apply-migrations.ts,
// so every file starts against the schema the repo actually ships — the same
// SQL a deploy runs, never a fixture that has drifted from it.
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // SESSION_SECRET is a secret in production (`wrangler secret put`)
          // and comes from .dev.vars locally; the suite supplies its own so
          // the presence token is signed with something known and stable.
          // ANTHROPIC_API_KEY is deliberately absent: a test that wants an
          // engine sets it, and every other test proves the scripted path.
          bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: 'test-secret' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
