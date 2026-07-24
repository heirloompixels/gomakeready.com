.PHONY: run build print clean

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
