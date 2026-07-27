// Tests run inside workerd via the Cloudflare Vitest pool — the same runtime
// the Worker lives in, reading the same wrangler.jsonc. D1 and the session DO
// join the suite when they land (docs/TODO.md § 4–5).
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
});
