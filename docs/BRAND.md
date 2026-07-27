# Brand

## Name

| Context | Form |
|---|---|
| Spoken, written, legal | Go Make Ready |
| Wordmark / logo | `go, make, ready.` (lowercase, commas + period in plum) |
| Domain, email | gomakeready.com |
| Craft wink (redirect) | makeready.ink |
| Defensive (redirect) | getmakeready.com |

The commas are a **typographic treatment**, not part of the spoken name.
They do not appear in the domain, email, or speech.

The name inverts "ready, set, go." Readiness is where you *arrive*, not the bar
you clear before starting. That is the whole promise, compressed.

Underneath sits **makeready** — the letterpress term for the meticulous setup a
printer does before a run, so that every impression after comes out clean.

## Color

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0d1f29` | Prussian-derived near-black. Rules, display type, closing band. |
| `--plum` | `#7d4060` | Accent. Commas, links, CTAs, rules of emphasis. |
| `--plum-deep` | `#5e2d47` | CTA hover. |
| `--plum-pale` | `#c98bab` | Plum on the dark band only. |
| `--paper` | `#f7f4ef` | Cream ground. |
| `--paper-2` | `#fbf9f6` | Inset panels. |
| `--rule` | `#d8d1c7` | Hairlines. **Warm**, never cold grey. |
| `--grey` | `#55606a` | Body copy at reduced emphasis. |
| `--grey-light` | `#8d949b` | Small caps, labels. |

**No blue.** If blue is ever structurally unavoidable it is Prussian blue in
oil-paint shades — which is what `--ink` already is. Never a bright tech blue.

Print is **two inks only**: `--ink` and `--plum`. No tints, no gradients, no
halftones. Every mark is solid, so it is two plates and nothing else. The
design must still read if the plum plate is dropped.

## Type

| Role | Face |
|---|---|
| Display, body | EB Garamond (400, 500, 600, italics) |
| Utility: labels, nav, buttons, small caps | DM Sans (400, 500, 700) |

The mockups load Google Fonts via `<link>`. **The Worker does not** — pages are
self-contained at runtime, zero external requests (CLAUDE.md § Design). The
served faces are subsets of the same variable TTFs the print source embeds,
`print/fonts/` → `assets/fonts/`, latin only, weight axis intact:

```
for f in EBGaramond:eb-garamond EBGaramond-Italic:eb-garamond-italic DMSans:dm-sans; do
  uvx --with brotli --from fonttools pyftsubset "print/fonts/${f%%:*}.ttf" \
    --output-file="assets/fonts/${f##*:}.woff2" --flavor=woff2 \
    --unicodes="U+0000-00FF,U+2000-206F,U+2074,U+20AC,U+2212,U+2215"
done
```

No `--instance`: the axes survive, so `@font-face` in `assets/brand.css`
declares ranges (`font-weight: 400 800` for EB Garamond, `100 1000` for DM
Sans, which also keeps its `opsz` axis) and one file covers every weight the
page sets. 851K/754K/240K of TTF become 42K/44K/58K of woff2.

## Structure

Swiss grid discipline — hard rules, strict columns, real negative space —
carrying letterpress warmth. It should read as **a practice, not a startup**.

Recurring devices:

- The **registration mark** (circle + crosshair, plum hairline) bleeding off a
  corner. Print convention. Use sparingly; once per surface.
- The **impression** animation: display type arrives with opacity + a slight
  blur lifting, like type settling into paper. Never a slide or a bounce.
- The **ledger**: a two-column table, "what eats the week" → "what it becomes."
  This is the single most persuasive object in the whole identity. The client
  sees their own Monday on the left.

## Voice

Lead with **time returned**. Never lead with "AI." Never imply the tool
replaces the client's taste, voice, or judgment — that judgment is the only
thing anyone pays them for.

No hype. No jargon. No exclamation points. Unhurried, plainspoken, a little
dry. The nineties credential (Unix on Sun/SGI/BSD/Linux, freelance web when the
web was hard) is stated once, plainly, and never oversold.

Standing lines:

> No jargon. No hype. No lock-in.

> Practical AI, set up by hand.

> Nobody hired anyone to write meta descriptions.
