# EZ Shots

Marketing and portfolio site for a real estate photography business serving realtors
across Metro Detroit: photos, listing video and FAA Part 107 drone work.

Plain HTML, CSS and vanilla JavaScript. No framework, no build step. Deployed on
Railway, served as static files.

> Working on this with Claude? Read `CLAUDE.md` and `PROJECT-STATE.md` first. They
> carry the rules and the session history. This file is only the map.

## Run it locally

```bash
npm install
npm start
```

Serves on `http://localhost:3000`. `npm test` runs the form checks described below.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home. Hero, services, packages, portfolio, lead form |
| `services.html` | What is included in a shoot |
| `packages.html` | Pricing, the two packages, Stripe buy links |
| `guarantee.html` | The offer in full: half price first shoot, 48 hour refund |
| `portfolio.html` | Project grid, built from `js/projects.js` |
| `project.html` | Project detail, loads one project by `?id=` |
| `about.html` | The photographer |
| `contact.html` | Second lead form |
| `intake.html` | Post booking shoot details form. Sent to clients after they book, `noindex` |
| `areas.html`, `faq.html` | Footer pages |
| `terms.html`, `refund.html`, `privacy.html` | Legal |

There is no `gallery.html`. The standalone gallery was removed on 2026-09-01. A
project's `gallery` array is a different thing: the frames for that one property.

## Where the moving parts live

- `js/site.js` builds the announcement bar, nav and footer on every page. **Adding a
  page means adding it to the `links` array here**, not just creating the file. It also
  owns the mobile drawer and the light/dark toggle.
- `js/projects.js` is the portfolio content. Edit shoots here, never in the HTML.
- `js/render.js` renders the grid and the detail page from that data.
- `js/contact-form.js` is the one handler behind every `form.lead-form`. See below.
- `css/styles.css` is the whole stylesheet, tokens at the top.
- `scripts/check-forms.mjs` is the test. `npm test` runs it.

## Forms

Every form with class `lead-form` wires itself up from `js/contact-form.js` and mails
through EmailJS. There is no backend.

The EmailJS template has seven fixed variables and cannot grow one per question, so
any field that is not name, email, phone or message is folded into the message body as
a `Label: value` line. **That means every field needs a `<label for>` or a
`data-label`**, or its answer arrives in the inbox unnamed. Per form behaviour is
declarative on the `<form>` element: `data-required`, `data-subject`,
`data-subject-field`, `data-success`.

Run `npm test` after touching any form. It catches the failures that are silent in a
browser: an unlabelled field, a duplicate name, a `data-required` that names a field
which does not exist, a missing honeypot.

Never add a lockbox or gate code field. Those emails sit in an inbox forever.
`intake.html` says the code gets texted the morning of the shoot instead.

## Files that look deletable and are not

- **`serve.json`** - without `cleanUrls: false`, `serve` redirects
  `/project.html?id=x` to `/project` and drops the query string, which breaks every
  portfolio detail page in production.
- **`Dockerfile`** - it is what makes Railway build with Docker. Without it Railway
  falls back to Railpack, which mounts every Railway service variable into the build as
  a BuildKit secret. On 2026-09-01 a variable named `EMAILJS.PUBLIC_KEY`, whose dot is
  illegal in an env var name, took every deploy down. The site needs no Railway
  variables at all; Railway supplies `PORT` itself.

## Theme

Light and dark are token based. `--brand` fills a shape, `--accent` colours text. They
are the same value in light mode and deliberately different in dark: a fill has to stay
dark enough for white to sit on it, text has to stay light enough to read on a near
black page. Every token that light defines, `[data-theme="dark"]` must define too. The
theme is set inline in each page's `<head>` before render so there is no flash, and
toggled in `js/site.js`. Keep both in sync.

## Deploy

Push to GitHub, Railway builds from the `Dockerfile` and runs `npm start`. The git
remote is named `ez-shots`, not `origin`. Work on `staging`, promote to `main`.
