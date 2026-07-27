// the scroll — the piece, server-rendered.
//
// mockups/05-the-scroll.html set in `hono/html`. The markup is the mockup's,
// line for line, less its own chrome: the mockup navigation strip and the
// links to sibling mockups are gone, the styles and the script left for
// files under assets/, and the handful of style="" attributes became classes
// so the page can be served with no 'unsafe-inline' anywhere in its policy.
//
// What the edge knows about the reader arrives twice: rendered into the
// smallnote, where the reader can see it, and as JSON on #edge, which the
// typist reads. Never concatenated into script — the town is a stranger's
// word, and strangers' words go in attributes, escaped.
// The letter act is no longer written here. The scripted letter and the one
// a real correspondence sets go through one template (src/letter.ts §
// letterArticle), so the demonstration and the document cannot drift.
import { html } from 'hono/html';
import type { Aggregates } from './db';
import type { Edge } from './greeting';
import { scriptedLetter } from './letter';

export const scroll = (edge: Edge, engine = false, record?: Aggregates) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>go, make, ready.</title>
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/scroll.css">
</head>
<body>

<header>
  <div class="wrap bar">
    <a href="#" class="brandmark">go<span class="p">,</span> make<span class="p">,</span> ready<span class="p">.</span></a>
    <nav>
      <!-- forks, not sections: each pours into the scroll -->
      <a href="#" class="fork" data-fork="what">What is this?</a>
      <a href="#" class="fork" data-fork="who">Who is doing this?</a>
      <a href="#" class="fork" data-fork="cost">What does it cost?</a>
      <a href="#" class="fork" data-fork="record">The record</a>
    </nav>
    <div class="end"><span class="eyebrow">Conversation <span class="d">·</span> Nº 052</span></div>
  </div>
</header>

<main class="flow" id="flow">

  <!-- I · the address -->
  <div class="entry first">
    <div class="rail eyebrow">go, make, ready. <span class="d">·</span> I</div>
    <div class="body">
      <h1 class="giant">
        <span>Go<span class="c">,</span></span>
        <span>make<span class="c">,</span></span>
        <span>ready<span class="c">.</span></span>
      </h1>
      <p class="spoken lede" id="greetline"></p>
      <div class="smallnote">Set at the edge for <b>${edge.town}</b> · no cookies, no tracking · a different line in Santa Fe</div>
    </div>
  </div>

  <!-- II · the sentence -->
  <div class="entry hid" id="act2">
    <div class="rail eyebrow">A correspondence <span class="d">·</span> II</div>
    <div class="body">
      <p class="cline on" id="line1">I keep
        <span id="bizChoices"><button class="pick">a gallery</button><span class="sep"> / </span><button class="pick">an outfitter</button><span class="sep"> / </span><button class="pick">a design studio</button><span class="sep"> / </span><button class="pick">an architecture practice</button><span class="sep"> / </span><button class="pick">a real-estate desk</button><span class="sep"> / </span><button class="pick">something else</button></span><span id="comma1" class="hid">,</span>
      </p>
      <p class="cline" id="line2"><span id="lead2"></span>
        <span id="frictionChoices" class="hid"><button class="pick">the same letters, over and over</button><span class="sep"> / </span><button class="pick">words for things I sell</button><span class="sep"> / </span><button class="pick">asking to be paid</button><span class="sep"> / </span><button class="pick">the calendar's little wars</button><span class="sep"> / </span><button class="pick">the feeds I feed</button><span class="sep"> / </span><button class="pick">the inbox, generally</button></span><span id="period2" class="hid">.</span>
      </p>
      <p class="cline" id="line3"><span id="lead3"></span>&nbsp;&nbsp;<button class="golink hid" id="golink">Go on →</button></p>

      <!-- the conversation continues in the same measure — no seam -->
      <div id="galley" class="galley"></div>
      <div class="setting" id="setting">Setting type <span class="sorts"><i>▪</i><i>▪</i><i>▪</i></span></div>
      <div class="suggest" id="chips"></div>
      <div class="desk" id="desk">
        <form id="deskform">
          <input type="text" id="deskinput" placeholder="Set your answer here…" autocomplete="off">
          <button class="cta" type="submit">Reply</button>
        </form>
      </div>
    </div>
  </div>

  <!-- III · the letter (revealed) -->
  <div class="entry hid" id="act4">
    <div class="rail eyebrow">The letter <span class="d">·</span> III</div>
    <div class="body">
      ${scriptedLetter()}
    </div>
  </div>

  <!-- forks pour in here, wherever the reader is -->

</main>

<!-- V · the ask -->
<section class="ask" id="ask">
  <div class="inner">
    <div class="rail eyebrow">The ask <span class="d">·</span> IV</div>
    <div>
      <h2>An hour of my attention, on your material. Fifty dollars. <em>The money is what makes it honest.</em></h2>
      <p>Free hours are worth what they cost. Mine begins before we meet — I'll arrive with
        something already built from your own shop, and you keep whatever we make, along
        with your letter, printed and set properly. If the hour isn't worth it, say so,
        and the fifty comes back.</p>
      <form>
        <input type="email" name="email" placeholder="you@yourshop.com" required>
        <!-- The honeypot. Off the page, out of the tab order, hidden from a
             screen reader: no honest hand can reach it, so anything in it
             came from a machine. Served in the markup rather than added by
             script, so it is there for a reader with no JavaScript too. -->
        <input class="trap" type="text" name="website" tabindex="-1" aria-hidden="true" autocomplete="off">
        <button class="cta" type="submit">Claim the hour — $50</button>
      </form>
      <div class="meta">In Bozeman through the summer · elsewhere by Zoom<br>
        presented with <a href="https://torc.art">Truth or Consequences Contemporary</a> — torc.art</div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div><b>go, make, ready.</b> — an artwork that is also an offer.</div>
    <div>Kyle Parker Cunningham · with <a href="https://torc.art">Truth or Consequences Contemporary</a>, T or C, New Mexico</div>
  </div>
</footer>

<div id="edge" hidden data-edge="${JSON.stringify({ town: edge.town, greeting: edge.greeting, engine, record })}"></div>
<script src="/scroll.js" defer></script>
</body>
</html>
`;
