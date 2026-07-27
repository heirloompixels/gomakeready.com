.PHONY: run build print clean dev typecheck test check

# ————— the Workers app (the piece; docs/TODO.md § the build)

# Local Worker at localhost:8787. No Cloudflare account needed.
dev:
	pnpm wrangler dev

typecheck:
	pnpm typecheck

test:
	pnpm test

# What CI runs, and what must be green before a step is done.
check:
	pnpm check
	pnpm typecheck
	pnpm test

# ————— the Zola brochure (live until the Worker replaces it)

run:
	zola serve

build:
	zola build

# Re-render the letterpress leave-behind. Requires: pip install weasyprint
print:
	cd print && python3 -c "from weasyprint import HTML; HTML('leavebehind.html').write_pdf('leavebehind.pdf')"
	@echo "print/leavebehind.pdf — 5.5x8.5, two inks"

clean:
	rm -rf public
