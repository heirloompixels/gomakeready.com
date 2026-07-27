// The pool types `env` as the global Cloudflare.Env; graft the Worker's
// real Env onto it, plus the migrations the setup file applies. The engine
// tests set ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL on it, both of which the
// Worker's Env already declares optional.
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../src/types';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
