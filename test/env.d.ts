// The pool types `env` as the global Cloudflare.Env; graft the Worker's
// real Env onto it.
import type { Env as WorkerEnv } from '../src/types';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
