# PROJECT-STATE.md - EZ Shots

## How to use this file
This file is the memory between sessions. Read it at the start of every session along with `CLAUDE.md`. At the end of every session, append a new dated entry to the top of the Work Log describing what changed and anything the next session would otherwise have to rediscover. "Blocked on a human" lists things only the owner can do (accounts, keys, DNS, deploy clicks). Detailed per-area status lives in `docs/site.md`.

## Blocked on a human
- **EmailJS Public Key.** `js/contact-form.js` has `PUBLIC_KEY: "__PASTE_EMAILJS_PUBLIC_KEY_HERE__"`. Paste the real key from EmailJS -> Account -> General -> API Keys. The form cannot send until this is done.
- **Confirm the EmailJS Template ID.** The code uses `template_qlotxua`. The template that actually sends to the lead inbox is whichever of `template_qlotxua` / `template_ztl1ney` has its "To Email" set to angelobrown1000@gmail.com. Open both in the dashboard, confirm which one, and update `TEMPLATE_ID` if it is the other.
- **Save the EmailJS template changes.** In the chosen template set Subject to `New lead from {{site_name}} - {{from_name}}` and include a `Site: {{site_name}}` line plus Name, Email, Phone, Message in the body, with "To Email" = angelobrown1000@gmail.com and "Reply To" = `{{reply_to}}`. Make sure the template contains these variables: `site_name`, `from_name`, `email_id`, `reply_to`, `phone`, `message`, `subject`. Click Save in the dashboard, template edits do not deploy from code.
- **Create the `staging` branch.** The repo currently has only `main`. Create `staging` before doing branch-based work (command is in the git handover of the session below).
- **No branch protection** is set on `main`. Optional: add protection on GitHub so production is only updated via the tested staging flow.

## Work Log (newest first)

### 2026-08-22 - Add EmailJS contact form and set up project memory
- Set up project memory files so future sessions start from written state: `CLAUDE.md`, this `PROJECT-STATE.md`, and `docs/site.md`.
- Replaced the FormSubmit forms on `index.html` (#contact section) and `contact.html` with an EmailJS integration. Both forms share `js/contact-form.js` via the `form.lead-form` class.
- Added client-side validation (Name, Email, Message required; Phone optional; email format checked), a disabled "Sending..." button state, and visible success ("Thanks, we'll be in touch.") and error states via a `.form-status` element styled in `css/styles.css`.
- Hardcoded `SITE_NAME = "EZ Shots"` and send it as `site_name` on every submission so the lead email always names its origin even though templates are shared across sites. Subject is `New lead from EZ Shots - {name}`. The Package dropdown choice is folded into the message body.
- EmailJS config (Service ID `service_dburs96`, Template ID, Public Key placeholder, SITE_NAME) lives in the `CONFIG` object at the top of `js/contact-form.js`. These are publishable client-side keys; a static site has no build step so there are no env files.
- How verified: `node --check` passed on the JS; confirmed no em-dashes or en-dashes in any touched file (`index.html`, `contact.html`, `css/styles.css`, `js/contact-form.js`, and the new markdown). Could not do a live test submit because the Public Key is still a placeholder. See "Blocked on a human" for the manual steps needed to make sending work.
- Note: the free EmailJS plan has a monthly request cap (currently showing 200 sends/month). Fine for lead volume, not for bulk.
- Staging branch does not exist yet. Create it with: `git checkout -b staging` (from `main`), then push with `git push -u ez-shots staging`.
