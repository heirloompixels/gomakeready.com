# TODO

## Blocking launch

- [ ] **Pricing.** `The setup` and `On call` show `$——` placeholders in
      `content/engagement.md`. Kyle has not set these. **Do not invent
      numbers.** Ask.
- [ ] **Trademark check.** A Dallas hospitality company ("Makeready", ~$78M
      revenue, boutique hotels + restaurants, founded 2016) holds the bare word
      in Class 43. Go Make Ready is a different phrase in different classes
      (35 business consulting / 41 training / 42 software consulting), and
      likelihood-of-confusion is probably low — but *probably* is not a
      clearance. One hour with a trademark attorney before anything is printed
      or letterpressed. Domain registration confers **no** trademark rights.

## Deploy

- [x] Repo on GitHub (`heirloompixels/gomakeready.com`, public), pushed to `main`.
- [x] GitHub Actions build + deploy workflow green. Serves at
      `heirloompixels.github.io/gomakeready.com` until the domain points over.
- [x] Pages enabled with GitHub Actions as the build source.
- [ ] Buy `gomakeready.com`, then add DNS: four apex `A` records to the GitHub
      Pages IPs (+ optional AAAA), `www` CNAME → `heirloompixels.github.io`.
      See `docs/DEPLOY.md`.
- [ ] Set the custom domain in **Settings > Pages** and, once DNS propagates,
      tick **Enforce HTTPS**.

## Before first client

- [ ] Contact path. Currently `mailto:`. For a referral practice that is
      arguably correct — a form adds friction and a spam surface. Revisit only
      if volume demands it.
- [ ] Self-host the two webfonts (`print/fonts/` already has the variable TTFs)
      to drop the Google Fonts request. Subset to Latin.
- [ ] Favicon + `og:` tags. Use the registration mark.
- [ ] `robots.txt`, `sitemap.xml`.

## Print

- [ ] Proof the leave-behind on the Vandercook 325G. It is designed for two
      plates (Prussian + plum) at 5.5×8.5 — the trim already in use.
- [ ] Business card + letterhead in the same two inks.
- [ ] Confirm the leave-behind still reads with the plum plate dropped
      (one-color fallback). It should.

## Deliberately not doing

- Analytics. No.
- A blog. Not yet, and not without a reason.
- A CMS. It is a brochure site. It changes four times a year.
- Any JS framework, bundler, or CSS framework. See CLAUDE.md.
