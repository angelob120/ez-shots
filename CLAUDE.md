# CLAUDE.md - EZ Shots

## What this is
EZ Shots is a static marketing and portfolio website for a real estate photography business serving realtors in Metro Detroit (photo, video, and licensed FAA Part 107 drone work). It is plain HTML, CSS, and vanilla JavaScript with no build step and no framework. Shared announcement bar, nav and footer are injected by `js/site.js`; portfolio and gallery content lives as data in `js/projects.js` and is rendered by `js/render.js`. It is served as static files by the `serve` package (`npm start`) and deploys on Railway. The lead contact form emails submissions to the owner through EmailJS (client side, no backend).

## The offer the site sells
Everything on the site points at one offer. Do not water it down or contradict it in copy:
- First shoot 50% off. Listing Essentials $150 becomes $75, Listing Pro $250 becomes $125.
- 48 hour full refund window on every delivered gallery, the first one and every one after.
- Average delivery about 24 hours, hard ceiling 72 hours or the shoot is free.
- Drone aerials are included in both packages, never sold as an add on.
The full wording lives on `guarantee.html` and is restated formally on `refund.html`. If one changes, change both.

## Absolute rule: no dashes
Never write an em-dash or an en-dash anywhere: not in code, comments, docs, commit messages, or replies to the owner. Use a plain hyphen `-` or split the sentence in two. Check every file you touch before you finish. (Older untouched pages may still contain them; clean them only when you edit that file.)

## Rules that will bite you
- The git remote is named `ez-shots`, not `origin`. Pushes go to `git push ez-shots <branch>`. The GitHub repo is https://github.com/angelob120/ez-shots.git.
- There are two lead forms, one in the `#contact` section of `index.html` and one on `contact.html`. Both share `js/contact-form.js` via the `form.lead-form` class. Change form behaviour in the JS once, not per page. If you add a third form, give it class `lead-form` and it wires itself up.
- `form.name` in JavaScript returns the form's name attribute, not the input named "name". The handler reads fields with `form.elements.namedItem(...)` for this reason. Do not switch to `form.name.value`.
- EmailJS keys are publishable client-side keys and live in the `CONFIG` object at the top of `js/contact-form.js`, not in env files (this is a static site with no build step). The `PUBLIC_KEY` is a placeholder until the owner pastes the real one.
- Nav links are hardcoded in `js/site.js`. Adding a page means adding it to the `links` array there (or the footer block below it), not just creating the file. Nav is Services, Portfolio, Pricing (`packages.html`), Guarantee, About, Contact. Gallery, FAQ and Areas live in the footer only.
- `serve.json` is load bearing. Without `cleanUrls: false`, `serve` 301s `/project.html?id=x` to `/project` and drops the query string, which breaks every portfolio detail page in production. The rewrites in that file also serve `/index.html` at `/` and let `/services` resolve to `/services.html`. Do not delete it.
- `Dockerfile` is load bearing. Railway builds with Docker because of it. Without it Railway
  falls back to Railpack, which mounts every Railway service variable into the build as a
  BuildKit secret, and on 2026-09-01 a variable named `EMAILJS.PUBLIC_KEY` (a dot is illegal
  in an env var name) took every deploy down with `secret EMAILJS not found`. The site needs
  no Railway variables at all, Railway supplies `PORT` itself.
- Theme (light/dark) is set inline in each page's `<head>` before render to avoid a flash, and toggled in `js/site.js`. Keep both in sync if you touch theming.
- Portfolio/gallery content is data in `js/projects.js`. Edit content there, not in the HTML.

## Session protocol
1. Start every session by reading `CLAUDE.md` and `PROJECT-STATE.md`.
2. Do all work on the `staging` branch. `main` is production.
3. Finish every session by appending a dated entry to the top of the Work Log in `PROJECT-STATE.md`: what changed, why, anything the next session would otherwise rediscover, and how you verified it.
4. Run git yourself and promote to production. The owner asked for this on 2026-09-01, it replaces the old "never run git, hand over commands" rule. Commit after every finished and verified change, not batched at the end of the session.

## Git flow (run this, do not hand it over)
Remote is `ez-shots`, not `origin`. After each finished change:

```
git checkout staging && git add <files> && git commit -F- <<'MSG'
Short imperative subject

- what was done, as a bullet
- another thing that was done
MSG
git push ez-shots staging
git checkout main && git pull ez-shots main && git merge staging && git push ez-shots main
git checkout staging && git merge main && git push ez-shots staging
```

Always end back on `staging` with both branches level. Verify with `git log --oneline -5` and confirm `main` moved before reporting done.

Commit message: short imperative subject, blank line, then `- ` bullets, one per line. No paragraphs, no `Co-Authored-By` or attribution trailer, no dashes of any kind (em or en) in the message.
