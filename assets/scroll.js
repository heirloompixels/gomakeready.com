// the scroll — the client hand.
//
// Ported from mockups/05-the-scroll.html. The typist, the sentence on-ramp,
// the conversation, the forks and the letter are the mockup's, unchanged.
// Two things moved: the greeting is now composed at the edge and handed in
// as JSON on #edge (the browser no longer guesses the town or the hour), and
// the ask form's handler, which the mockup wrote as an onsubmit attribute,
// is bound here so no script runs inline.
//
// The conversation below is still scripted. The model engine lands at
// step 4 (docs/TODO.md); this file is what it will be poured into.

// What the Worker knew about the reader, read once, not concatenated into code.
const EDGE = JSON.parse(document.getElementById('edge').dataset.edge);

// ============================================================================
// the human typist
// ============================================================================
const NEAR = {
  a: 'sq',
  b: 'vn',
  c: 'xv',
  d: 'sf',
  e: 'wr',
  f: 'dg',
  g: 'fh',
  h: 'gj',
  i: 'uo',
  k: 'jl',
  l: 'k',
  m: 'n',
  n: 'bm',
  o: 'ip',
  p: 'o',
  r: 'et',
  s: 'ad',
  t: 'ry',
  u: 'yi',
  v: 'cb',
  w: 'qe',
  y: 'tu',
};
const slip = (c) => {
  const n = NEAR[c.toLowerCase()];
  return n ? n[Math.floor(Math.random() * n.length)] : c;
};
function buildTape(text, o) {
  const q = [];
  const words = text.split(' ');
  let typos = 0;
  const maxTypos = o.maxTypos ?? 3;
  let retypeAt = -1;
  if (o.retype !== false) {
    const cands = words
      .map((w, i) => ({ w, i }))
      .filter((x) => x.i > 2 && x.i < words.length - 3 && x.w.replace(/[^a-z]/gi, '').length >= 5);
    if (cands.length) retypeAt = cands[Math.floor(Math.random() * cands.length)].i;
  }
  words.forEach((w, wi) => {
    for (const c of w) {
      if (/[a-z]/i.test(c) && typos < maxTypos && Math.random() < 0.035) {
        q.push({ a: 'type', c: slip(c) });
        q.push({ a: 'pause', ms: 280 + Math.random() * 260 });
        q.push({ a: 'bs' });
        typos++;
      }
      q.push({ a: 'type', c });
    }
    if (wi === retypeAt) {
      q.push({ a: 'pause', ms: 300 });
      for (let k = 0; k < w.length; k++) q.push({ a: 'bs' });
      q.push({ a: 'pause', ms: 220 });
      for (const c of w) q.push({ a: 'type', c });
    }
    if (wi < words.length - 1) {
      q.push({ a: 'type', c: ' ' });
      if (/[,.]$/.test(w)) q.push({ a: 'pause', ms: 420 });
      else if (Math.random() < 0.12) q.push({ a: 'pause', ms: 220 + Math.random() * 380 });
    }
  });
  return q;
}
function humanType(el, text, done, o = {}) {
  const caret = document.createElement('span');
  caret.className = 'caret';
  const q = buildTape(text, o);
  const render = (buf) => {
    let h = buf;
    (o.ems || []).forEach((p) => {
      h = h.replace(p, '<em>' + p + '</em>');
    });
    el.innerHTML = h;
    el.appendChild(caret);
  };
  (function run(idx, buf) {
    if (idx >= q.length) {
      setTimeout(() => {
        caret.remove();
        if (done) done();
      }, o.hold ?? 400);
      return;
    }
    const e = q[idx];
    const v = o.speed ?? 1; // <1 = a quicker hand (forks); pauses shrink with it
    if (e.a === 'type') {
      const next = buf + e.c;
      render(next);
      setTimeout(() => run(idx + 1, next), (42 + Math.random() * 46) * v);
    } else if (e.a === 'bs') {
      const next = buf.slice(0, -1);
      render(next);
      setTimeout(() => run(idx + 1, next), (55 + Math.random() * 45) * v);
    } else setTimeout(() => run(idx + 1, buf), e.ms * v);
  })(0, '');
}

// ============================================================================
// I · the address — the disclosure hides in plain sight
// ============================================================================
// The town and the hour were settled at the edge; the hand only types them.
const greet = EDGE.greeting;

setTimeout(() => {
  humanType(
    document.getElementById('greetline'),
    greet,
    () => {
      const a2 = document.getElementById('act2');
      a2.style.display = 'grid';
      a2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    { ems: ['No one is typing this.'], hold: 900 },
  );
}, 1100);

// ============================================================================
// II · the sentence
// ============================================================================
document.querySelectorAll('#bizChoices .pick').forEach((b) => {
  b.addEventListener('click', () => {
    const wrap = document.getElementById('bizChoices');
    wrap.querySelectorAll('.sep').forEach((s) => {
      s.remove();
    });
    wrap.querySelectorAll('.pick').forEach((x) => {
      if (x !== b) x.classList.add('gone');
    });
    b.classList.add('set');
    document.getElementById('comma1').style.display = 'inline';
    setTimeout(() => {
      document.getElementById('line2').classList.add('on');
      humanType(
        document.getElementById('lead2'),
        'and the week disappears into',
        () => {
          const fc = document.getElementById('frictionChoices');
          fc.style.display = 'inline';
          let d = 0;
          fc.querySelectorAll('.pick, .sep').forEach((elm) => {
            elm.classList.add('press-in');
            elm.style.animationDelay = d + 's';
            if (elm.classList.contains('pick')) d += 0.14;
          });
        },
        { maxTypos: 1, retype: false, hold: 250 },
      );
    }, 420);
  });
});

let picked = 0;
let closing = false;
document.querySelectorAll('#frictionChoices .pick').forEach((b) => {
  b.addEventListener('click', () => {
    const on = b.classList.toggle('set');
    picked += on ? 1 : -1;
    document.getElementById('period2').style.display = picked > 0 ? 'inline' : 'none';
    if (picked > 0 && !closing) {
      closing = true;
      setTimeout(() => {
        document.getElementById('line3').classList.add('on');
        humanType(
          document.getElementById('lead3'),
          'Then there is something worth finding.',
          () => {
            const g = document.getElementById('golink');
            g.style.display = 'inline-block';
            g.classList.add('press-in');
          },
          { maxTypos: 1, retype: false, hold: 220 },
        );
      }, 420);
    }
  });
});

// ============================================================================
// III · the session — scripted here; streamed from the edge in the real build
// ============================================================================
const galley = document.getElementById('galley');
const setting = document.getElementById('setting');
const chipsEl = document.getElementById('chips');
const desk = document.getElementById('desk');
const form = document.getElementById('deskform');
const input = document.getElementById('deskinput');

function addTurn(role, html) {
  const t = document.createElement('div');
  t.className = 'turn ' + role;
  t.innerHTML =
    '<div class="who">' +
    (role === 'site' ? 'go, make, ready.' : 'You') +
    '</div><div class="txt">' +
    html +
    '</div>';
  galley.appendChild(t);
  t.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return t;
}
function setType(role, text, then) {
  setting.style.display = 'block';
  setting.scrollIntoView({ behavior: 'smooth', block: 'end' });
  setTimeout(() => {
    setting.style.display = 'none';
    const t = addTurn(role, '');
    const txt = t.querySelector('.txt');
    const words = text.split(' ');
    let acc = 0;
    words.forEach((w, i) => {
      acc += 75 + Math.random() * 55;
      if (i > 0 && /[,—.?]>?$/.test(words[i - 1])) acc += 200;
      if (Math.random() < 0.06) acc += 300 + Math.random() * 320;
      const s = document.createElement('span');
      s.className = 'press-word';
      s.style.animationDelay = acc + 'ms';
      s.innerHTML = w + '&nbsp;';
      txt.appendChild(s);
    });
    if (then) setTimeout(then, acc + 500);
  }, 850);
}
function offerChips(list, onPick) {
  chipsEl.innerHTML = '';
  const lead = document.createElement('span');
  lead.className = 'lead press-in';
  lead.textContent = 'Perhaps —  ';
  chipsEl.appendChild(lead);
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'pick press-in';
    b.style.animationDelay = 0.25 + i * 0.14 + 's';
    b.textContent = c;
    b.addEventListener('click', () => {
      chipsEl.innerHTML = '';
      onPick(c);
    });
    chipsEl.appendChild(b);
    if (i < list.length - 1) {
      const s = document.createElement('span');
      s.className = 'sep press-in';
      s.style.animationDelay = 0.25 + i * 0.14 + 's';
      s.textContent = '  /  ';
      chipsEl.appendChild(s);
    }
  });
  chipsEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// The arc: calibrate → (explain, re-ask) → teach to level → ideas made theirs
// → climax with the disclosure callback → the letter. In the real build the
// model improvises each turn inside these stages, carrying the level forward.
let level = null; // 'daily' | 'burned' | 'nodded' | 'new'

function askText(then) {
  desk.classList.add('on');
  input.focus();
  form.addEventListener('submit', function handler(e) {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;
    addTurn('you', val);
    input.value = '';
    desk.classList.remove('on');
    form.removeEventListener('submit', handler);
    then(val);
  });
}

// — II·i calibration —
function calibrate() {
  setType(
    'site',
    'Before we go further — the thing everyone keeps calling <em>AI.</em> How do you stand with it, honestly?',
    () =>
      offerChips(
        [
          'I use it most days',
          'I tried it once; it wrote me something wrong',
          'I have heard the letters — L, L, M — and nodded along',
          "truthfully, I don't know what any of it is",
        ],
        (pick) => {
          addTurn('you', pick);
          if (pick.startsWith('truthfully')) explain();
          else {
            level = pick.startsWith('I use')
              ? 'daily'
              : pick.startsWith('I tried')
                ? 'burned'
                : 'nodded';
            teach();
          }
        },
      ),
  );
}

// — the two-step: put it plainly, then ask again, gentler —
function explain() {
  setType(
    'site',
    'Then let me put it plainly, since nobody has: a machine that has read nearly everything ever written, and answers in <em>your own language.</em> That is all the letters mean. No code, no commands — you write to it the way you would write to a sharp new hire who never sleeps. <em>Closer?</em> Place yourself now —',
    () =>
      offerChips(
        [
          'that, I have used — my kid showed me',
          'I have seen it over shoulders, never touched it',
          'this is the first anyone has explained it',
        ],
        (pick) => {
          addTurn('you', pick);
          level = 'new';
          teach();
        },
      ),
  );
}

// — II·ii the teaching turn, pitched to where they stand —
const TEACH = {
  daily: {
    q: 'Most days — then you have seen the trick and I can skip the sermon. But there is a distance between <em>using it</em> and <em>owning it.</em> Most daily users are still typing into a little box, and the box forgets them by morning. Wired into a shop — your files, your voice, your ledger — the box disappears, and what remains is <em>leverage.</em>',
    chips: ['go on', 'that distance is where I live'],
  },
  burned: {
    q: 'Of course it wrote you something wrong. You were handed a hammer <em>by the head</em> and told to swing. The chatbot in the browser is the parlor trick — the demonstration model in the shop window. Wired into your own files, your own voice, your own standards, it is a different tool entirely: it does not guess at your business, <em>it knows it.</em>',
    chips: ['go on, then', 'convince me'],
  },
  nodded: {
    q: 'Nearly everyone is nodding along just now — the letters are new and the noise is enormous, and saying so out loud takes more honesty than the nodding does. So, plainly: a machine that has read nearly everything, and answers in your language. That is the whole secret. The rest is knowing <em>where in a shop to put it.</em>',
    chips: ['show me where', 'go on'],
  },
  new: {
    q: 'Then you are exactly who this page was set for. Not knowing is the country’s condition, not yours — most who claim fluency mean they tried it once at dinner. Which makes you, at this moment, <em>earlier than they are.</em>',
    chips: ['go on', 'show me what you mean'],
  },
};
function teach() {
  const t = TEACH[level];
  setType('site', t.q, () =>
    offerChips(t.chips, (pick) => {
      addTurn('you', pick);
      idea1();
    }),
  );
}

// — II·iii ideas, made theirs (drawn from the sentence: a gallery) —
function idea1() {
  setType(
    'site',
    'Picture it in your rooms, then. A collector writes at midnight about a painter you showed in 2019. By morning the reply is <em>drafted</em> — provenance, prices, your tone, your reserve — waiting beside your coffee. You mend one line and send it. <em>Would that matter, in your shop?</em>',
    () =>
      offerChips(
        ['that would matter', 'I would want to see it done', 'my case is odder than that'],
        (pick) => {
          addTurn('you', pick);
          idea2();
        },
      ),
  );
}
function idea2() {
  setType(
    'site',
    'Or the words the work is owed — the statements, the announcements, the tellings that wait for a quiet evening that never comes. Spoken aloud while you hang the show; set into drafts before you have locked the door. <em>Tell me — what would you do with the evenings that returns?</em>',
    () => askText(() => climax()),
  );
}

// — II·iv the climax: the turn, and the disclosure detonates —
function climax() {
  setType(
    'site',
    'Then hold that thought, because here is the part I came to say. What we are doing — right now, you and this page — is how computers will be used for the <em>next several decades.</em> You say what you mean, in your own words, and you are met. It is like the internet, but better — and it is <em>1996 again.</em> Remember what this page told you at the start: <em>no one is typing this.</em> That is what I have been showing you all along. So — were you early to the internet, or did it happen to other people first?',
    () =>
      offerChips(
        ['I was early', 'I caught up', 'it happened around me', 'I intend to be early this time'],
        (pick) => {
          addTurn('you', pick);
          finale();
        },
      ),
  );
}

document.getElementById('golink').addEventListener('click', () => {
  document.getElementById('golink').style.visibility = 'hidden';
  calibrate();
});

function finale() {
  setType(
    'site',
    'That is enough to see it — the hours, and the larger thing beneath them. Being early is not a slogan; wired into the actual grain of a shop, it is a <em>working advantage,</em> and it is what I do. Hold still. I am going to set you a letter.',
    () => {
      const a4 = document.getElementById('act4');
      a4.style.display = 'grid';
      // (act4 is the letter — the only remaining hard rule in the scroll)
      let d = 0;
      a4.querySelectorAll('.setin').forEach((elm) => {
        elm.classList.add('in');
        elm.style.animationDelay = d + 's';
        d += 0.28;
      });
      a4.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(
        () => {
          const ask = document.getElementById('ask');
          ask.classList.add('on');
        },
        d * 1000 + 600,
      );
    },
  );
}

// ============================================================================
// forks — the nav pours into the scroll
// ============================================================================
const FORKS = {
  what: {
    label: 'What is this?',
    paras: [
      'A fair question, asked early. This page is an artwork and an advertisement, and sees <em>no contradiction</em> — the old job-printing shops never did. The wedding invitation paid the rent and was still set true.',
      'A machine is speaking to you here, in a borrowed hand, about your own hours. The conversation is the piece. The demonstration is the product. What you say joins a public record at the bottom of this page — melted of every name.',
    ],
  },
  who: {
    label: 'Who is doing this?',
    paras: [
      'From the middle nineties to about 2010 I kept Unix machines alive — Sun, SGI, BSD — and built the web when there was no template to reach for. Just people who needed the thing, and a few of us who could make it.',
      '<b>Being early was a superpower.</b> Not because the technology was magic — because almost nobody knew where to put their hands, and I could sit down with an owner and show them. It is that morning again, only larger.',
      '<span class="sig">— Kyle Parker Cunningham · Bozeman &amp; T or C</span>',
    ],
  },
  cost: {
    label: 'What does it cost?',
    paras: [
      '<em>Fifty dollars</em> for the first hour — the money is what makes it honest, because my time goes in before we meet. You leave with something working, built on your own material, and your letter, printed. Kept either way.',
      'After that, if you want more: a half-day setup, priced plainly when we have met. No subscription of mine, nothing to babysit, nothing that owns you. Cancel any month, keep everything.',
    ],
  },
  record: {
    label: 'The record',
    tally: [
      { n: '51', l: 'conversations this season' },
      { n: '19', l: 'mentioned evenings' },
      { n: '11', l: 'asked about being paid' },
      { n: '212', l: 'hours found, in sum' },
    ],
    paras: [
      'The thing most often never written at all, across four towns: <em>the words for the work itself.</em> Descriptions, statements, announcements — the tellings.',
      'Nothing said here is kept whole. It is melted down like old type and recast without a name — and the record is public from the first day, printed each season as a broadside with <b>Truth or Consequences Contemporary</b>. Your conversation would be Nº 052.',
    ],
  },
};

document.querySelectorAll('.fork').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const f = FORKS[a.dataset.fork];
    if (!f || a.dataset.done) return;
    a.dataset.done = '1';
    a.style.color = 'var(--plum)';

    const entry = document.createElement('div');
    entry.className = 'entry quiet passage';
    entry.innerHTML =
      '<div class="rail eyebrow">' +
      f.label +
      '</div><div class="body"><p class="spoken qhead"></p></div>';
    document.getElementById('flow').appendChild(entry);
    entry.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const body = entry.querySelector('.body');
    humanType(
      entry.querySelector('.qhead'),
      f.label,
      () => {
        if (f.tally) {
          const t = document.createElement('div');
          t.className = 'tally in';
          t.innerHTML = f.tally
            .map(
              (x) =>
                '<div class="t"><div class="n">' +
                x.n +
                '</div><div class="l">' +
                x.l +
                '</div></div>',
            )
            .join('');
          body.appendChild(t);
        }
        f.paras.forEach((p, i) => {
          const el = document.createElement('p');
          el.innerHTML = p;
          el.classList.add('in');
          el.style.animationDelay = 0.3 + i * 0.5 + 's';
          body.appendChild(el);
        });
      },
      { maxTypos: 1, retype: false, hold: 300, speed: 0.55 },
    );
  });
});

// ============================================================================
// the ask — the mockup said this with an onsubmit attribute; inline script is
// not served here, so the handler is bound like everything else.
// ============================================================================
const askForm = document.querySelector('#ask form');
askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  askForm.querySelector('button').textContent = 'Spoken for. Watch your inbox.';
});
