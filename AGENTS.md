# CLAUDE.md — gomakeready.com

Read this before writing anything.

## What this is

The marketing site for **Go, Make, Ready** — Kyle Parker Cunningham's AI-integration
consulting practice. Small owner-operated businesses in Bozeman, Santa Fe, Vail,
and Aspen. Pitch: one hour with the business, Claude wired into the friction
points, hours returned every week after.

This is a **static brochure site** built using Zola. Resist growing it.

## Hard rules (non-negotiable)

These are project law. Do not violate them, do not propose violating them.

- **Zola Static Site.** Clean static output, no backend runtime server.
- **No JS build tooling.** No npm, no node_modules, no bundler, no transpiler.
  Hand-written JS in a `<script>` tag or a plain `.js` file. That is all.
- **No CSS frameworks.** No Tailwind, no Bootstrap. Hand-written CSS.
- **Hosting is GitHub Pages.** Automated deployment via GitHub Actions.

## Design constraints

The visual identity is settled. Do not redesign it.

- **Ink:** `#0d1f29` — a Prussian-derived near-black. Used for rules, display
  type, the dark closing band. It reads as *ink*, not as "blue."
- **Accent:** `#7d4060` — plum. Commas in the wordmark, rules, links, CTAs.
- **Paper:** `#f7f4ef` cream, `#fbf9f6` for inset panels.
- **Rules:** `#d8d1c7` — warm, never cold grey.
- **Kyle does not like blue.** If blue is ever unavoidable, it is Prussian blue
  in oil-paint shades. Never a bright/tech blue. Never ultramarine.
- **Type:** EB Garamond (display, body) + DM Sans (utility: labels, buttons,
  small caps, nav). Loaded from Google Fonts via `<link>`. No self-hosting yet.
- Wordmark is rendered **`go, make, ready.`** — lowercase, commas in plum.
  Spoken/written name is **Go Make Ready**. Legal/domain is `gomakeready.com`.

Structural feel: Swiss grid discipline (hard rules, strict columns, generous
negative space) carrying letterpress warmth (Garamond, cream, restraint). It
should read as *a practice*, not a startup.

## Voice

- Lead with **time returned**. Never lead with the word "AI."
- Never imply the tool replaces the client's taste, voice, or judgment.
- No hype, no jargon, no exclamation points. Plainspoken and unhurried.
- The credential is the nineties: Unix administration (Sun, SGI, BSD, Linux)
  and freelance web development, when being early was a superpower.

## Layout

```
config.toml          Zola configuration file
templates/           Zola HTML/Tera templates
content/             Markdown content files
static/              Static assets (fonts, images, CNAME)
print/               letterpress leave-behind source (HTML -> PDF, WeasyPrint)
docs/                deploy notes, brand tokens
.github/workflows/   GitHub Actions deployment workflow
```

## Running

```
make run             # starts `zola serve` at localhost:1111
```

## Build / Print

```
make build           # compiles the static site into `public/`
make print           # re-renders the letterpress leave-behind PDF
```

## Open tasks

See `docs/TODO.md`. The two that block launch are the pricing placeholders
(`$——` in the engagement section) and a trademark check. Do not invent prices.
