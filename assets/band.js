// The ask band, on a page that is not the scroll.
//
// A letter kept at its own address has no conversation, no typist and no
// stream — it is a printed document with one form under it. This is the same
// organ the scroll binds at the bottom of assets/scroll.js, hand-copied and
// cut down (copy, don't extract — CLAUDE.md § Reusable organs): the address
// goes to the desk, and the button wears whatever the desk says back.
//
// The Nº rides in a hidden field the server set, so the address joins the
// conversation the letter was set from. Without this script the form still
// posts; with it, the page never leaves.

const band = document.querySelector('#ask form');

if (band) {
  const button = band.querySelector('button');

  band.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;

    // Form-encoded, because a form is what this is — the honeypot and the
    // Nº ride along exactly as the markup wrote them.
    const body = new URLSearchParams(new FormData(band));

    let said = null;
    try {
      const r = await fetch('/ask', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (r.ok) {
        const answer = await r.json();
        said = typeof answer.said === 'string' ? answer.said : null;
      }
    } catch {
      said = null;
    }

    if (said) {
      button.textContent = said;
      return;
    }
    button.textContent = 'The press jammed. Try once more.';
    button.disabled = false;
  });
}
