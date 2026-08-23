# docs/site.md - EZ Shots site plan

One plan file is enough for a site this small. Mark items done in place as they land.

## Pages and shared chrome
- Done: `index.html` (hero, worked-with strip, portfolio teaser, gallery teaser, drone, about, packages, contact), `portfolio.html`, `gallery.html`, `about.html`, `packages.html`, `contact.html`, `project.html` (detail by `?id=`), and legal pages (`terms.html`, `refund.html`, `privacy.html`).
- Done: shared nav + footer injected by `js/site.js`; light/dark theme with no-flash inline set and toggle.
- Left: real content. Placeholders still in the copy include `[Your Name]`, `[Your City]`, the `[University Name]` / org badges, and the Unsplash placeholder images. Portfolio and gallery data live in `js/projects.js`.

## Contact / lead capture
- Done: EmailJS integration on both forms (index `#contact` and `contact.html`), shared via `js/contact-form.js` (`form.lead-form`). Fields Name, Email, Phone, Package, Property details. Validation, disabled sending state, success and error messages. Leads email angelobrown1000@gmail.com with `site_name` = "EZ Shots".
- Half done: needs the real EmailJS Public Key pasted and the template confirmed/saved in the dashboard. See PROJECT-STATE.md "Blocked on a human".
- Left: an owner test submit once the key is in, to confirm a real email lands.

## Commerce and booking
- Done: Stripe Buy Now links and a TidyCal "book a time to talk" link on the packages, revealed by the package "Book" buttons.
- Left: confirm the Stripe links and prices are current before launch.

## Deploy
- Done: `package.json` serves the static files via `serve` on Railway's `$PORT` (`npm start`).
- Left: connect the GitHub repo to Railway and add a public domain when ready to go live.
