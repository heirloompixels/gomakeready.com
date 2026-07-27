// The record — public from the first day, anonymized always.
//
// "Nothing said here is kept whole. It is melted down, like old type, and
// recast without a name." (CLAUDE.md § The piece.) This page is that
// sentence rendered: counts, towns, hours, and nothing that could be traced
// to a person. It selects no body, no email and no id, because
// recordAggregates() cannot hand it any (src/db.ts § the record).
//
// It is set on the house measure — the 190px rail and the body the scroll
// uses — and it reads correctly at zero. A record that only looks right once
// it is full is a record that was written to flatter.

import { html } from 'hono/html';
import type { Aggregates } from './db';

const LEVELS: Record<string, string> = {
  daily: 'use it most days',
  burned: 'tried it once, and it wrote them something wrong',
  nodded: 'have heard the letters and nodded along',
  new: 'had never had it explained plainly',
};

const span = (low: number, high: number): string => (low === high ? String(low) : low + '–' + high);

/** The four numbers, set large. The same .tally the record fork types out. */
export function tallies(r: Aggregates): { n: string; l: string }[] {
  return [
    { n: String(r.conversations), l: 'conversations in the record' },
    { n: String(r.letters), l: 'letters set' },
    { n: String(r.towns), l: r.towns === 1 ? 'town' : 'towns' },
    { n: span(r.hoursLow, r.hoursHigh), l: 'hours a week found, in sum' },
  ];
}

// Two short sentences, in register. An empty record is a fact about the
// hour, not a defect in the page.
const EMPTY =
  'The record opens empty, which is a fact, not a flaw. Every conversation that ' +
  'reaches its end is added here, melted, and the first one has not happened yet.';

const FULL =
  'Every conversation that reaches its end is added here — the counts only, and ' +
  'never the words. What is printed below is the whole of what is kept.';

export const record = (r: Aggregates) => {
  const levels = Object.entries(r.byLevel).filter(([k]) => k in LEVELS);
  const trades = Object.entries(r.byTrade);
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>go, make, ready. — the record</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/scroll.css">
</head>
<body>

<header>
  <div class="wrap bar">
    <a href="/" class="brandmark">go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span></a>
    <nav><a href="/">The conversation</a></nav>
    <div class="end"><span class="eyebrow">The record <span class="d">·</span> ${r.total} in all</span></div>
  </div>
</header>

<main class="flow">
  <div class="entry first">
    <div class="rail eyebrow">The record <span class="d">·</span> public</div>
    <div class="body passage">
      <h1 class="giant"><span>The record<span class="c">.</span></span></h1>
      <div class="tally in">
        ${tallies(r).map(
          (t) => html`<div class="t"><div class="n">${t.n}</div><div class="l">${t.l}</div></div>`,
        )}
      </div>
      <p class="in">${r.conversations === 0 ? EMPTY : FULL}</p>
      <p class="in">Nothing said here is kept whole. It is melted down, like old type, and
        recast without a name.</p>
      <p class="in">Printed each season as a letterpress broadside with
        <b>Truth or Consequences Contemporary</b> — <a href="https://torc.art">torc.art</a>,
        the gallery in Truth or Consequences, New Mexico.</p>
    </div>
  </div>

  <div class="entry quiet">
    <div class="rail eyebrow">Where they stood</div>
    <div class="body passage">
      ${
        levels.length === 0
          ? html`<p class="in">Nobody has placed themselves yet.</p>`
          : html`<ul class="ledger">${levels.map(
              ([k, n]) => html`<li><b>${n}</b> ${LEVELS[k]}</li>`,
            )}</ul>`
      }
    </div>
  </div>

  <div class="entry quiet">
    <div class="rail eyebrow">What they keep</div>
    <div class="body passage">
      ${
        trades.length === 0
          ? html`<p class="in">No trades have been named yet.</p>`
          : html`<ul class="ledger">${trades.map(([k, n]) => html`<li><b>${n}</b> ${k}</li>`)}</ul>`
      }
    </div>
  </div>
</main>

<footer>
  <div class="wrap">
    <div><b>go, make, ready.</b> — an artwork that is also an offer.</div>
    <div>Kyle Parker Cunningham · with <a href="https://torc.art">Truth or Consequences Contemporary</a>, T or C, New Mexico</div>
  </div>
</footer>

</body>
</html>
`;
};
