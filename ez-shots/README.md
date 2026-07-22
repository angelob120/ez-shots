# EZ Shots — Real Estate Photography Website

Clean, modern portfolio site for a real estate photography business. Home page with hero,
portfolio grid, pricing packages, and a contact form. Each project links to its own detail page.

## Files
- `index.html` — home page (hero, portfolio, packages, contact)
- `project.html` — project detail page (loads a project by `?id=` from the URL)
- `js/projects.js` — **all your portfolio content lives here** (titles, photos, descriptions)
- `css/styles.css` — styling
- `package.json` — lets Railway serve the static site

## Editing content later
Open `js/projects.js` and replace the image URLs, titles, and descriptions with your real
shoots. Add or remove projects by adding/removing entries in the list. Each project's `id`
must be unique. The home grid and detail pages update automatically.

Update your **phone number** (`(555) 123-4567`) and **service area** (`[Your City]`) by
searching for them in `index.html` and `project.html`.

## Contact form
The form uses [FormSubmit](https://formsubmit.co) so submissions email you with no backend.
The first time someone submits, FormSubmit sends a one-time confirmation email to
`bigmoneygelo2@gmail.com` — click the link to activate it.

## Preview locally
```bash
npx serve .
```
Then open the URL it prints.

## Deploy on Railway
1. Push these files to a GitHub repo (or drag the folder into a new Railway project).
2. In Railway, create a new project → Deploy from your repo.
3. Railway auto-detects Node, runs `npm install`, then `npm start`.
4. `npm start` serves the site on Railway's `$PORT`. Add a public domain in Railway settings.

No extra config needed — `package.json` handles it.
