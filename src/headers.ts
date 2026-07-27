// The guard trio: the three headers every surface carries, whatever it
// answers with — the page, the machine door, the redirect, the miss.
//
// Copied whole from portals/the200/src/headers.ts (copy, don't extract —
// CLAUDE.md § Reusable organs); only the policy handed in differs.
//
// cache-control is deliberately not here. It is chosen per surface — stable
// pages, the no-store of anything a session touches — and a middleware that
// guessed it would flatten a deliberate cache policy into one sentence.

import type { MiddlewareHandler } from 'hono';

export const guardHeaders =
  (csp: string): MiddlewareHandler =>
  async (c, next) => {
    await next();
    c.res.headers.set('content-security-policy', csp);
    c.res.headers.set('x-content-type-options', 'nosniff');
    c.res.headers.set('referrer-policy', 'no-referrer');
  };
