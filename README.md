# Go Make Ready

The marketing site for **Go Make Ready** — practical AI integration for owner-operated businesses in Bozeman, Santa Fe, Vail, and Aspen.

The site is built as a static site using the **Zola** static site generator.

## Running and Building

```sh
make run          # Starts a local Zola dev server (localhost:1111)
make build        # Compiles the static site to the /public directory
make print        # Re-renders the letterpress leave-behind PDF
```

## Layout

```
CLAUDE.md            Project law — read first
config.toml          Zola configuration file
templates/           Zola HTML/Tera templates
  index.html         The homepage layout, CSS, and interactive JS
content/             Markdown content files — all site copy lives here
static/              Static assets (fonts, images, etc. copied as-is)
print/               Letterpress leave-behind brochure, 5.5x8.5, two inks
  leavebehind.html   HTML print source
  leavebehind.pdf    Rendered PDF ready for printing
  fonts/             EB Garamond + DM Sans variable TTFs
docs/BRAND.md        Color, type, voice styling tokens
docs/DEPLOY.md       Deployment instructions (GitHub Pages + DNS)
docs/TODO.md         Outstanding launch tasks
```

## The core idea

Kyle ran Unix systems and built the web in the nineties. That was one computing shift, and being early was a superpower. This is the next one, larger, and most small-business owners have no idea where to put their hands.

The offer: one hour on how the business actually runs, then Claude wired into the exact points of friction. No platform, no subscription, no lock-in. The client keeps the hours it gives back.

Lead with time returned. Never lead with "AI."
