# Restaurant Onboarding Checklist

Use this every time you onboard a new restaurant onto EZ Orders. Work top to bottom — the order matters, since a tenant can't take a live order until basics, menu, and hours are done.

**Restaurant name:** ______________________
**Slug (`/r/______`):** ______________________
**Plan (ZERO / FLAT / HYBRID):** ______________________
**Date started:** ______________________

---

## 1. Account & basics

- [ ] Create the tenant record and confirm the slug is correct and unique
- [ ] Send the owner an **invite link** (never set a password for them — invite is single-use and the only supported path)
- [ ] Confirm owner redeemed the invite and can sign in to `/dashboard`
- [ ] Business name, address, and contact phone entered
- [ ] Timezone set correctly (every hours/booking decision is made in the restaurant's own timezone — a wrong timezone breaks ordering hours silently)

## 2. Menu

- [ ] Menu imported — link import (DoorDash / Uber Eats / Toast) or CSV upload
- [ ] **Reviewed the price scale for the WHOLE menu** (cents vs dollars — confirm nothing is 100x off)
- [ ] Confirmed modifiers/options did not get imported as standalone dishes
- [ ] Categories and item order look right
- [ ] Pressed **Import** to commit (scraped menu is only a proposal until this)
- [ ] Spot-checked 3–5 items and prices against the real menu

## 3. Hours & availability

- [ ] Weekly hours configured (`hoursJson`, not the free-text hours field)
- [ ] Last-call cutoff set if they want one
- [ ] Any holiday closures added
- [ ] Confirmed storefront shows OPEN during open hours and CLOSED outside them
- [ ] Reminder: a tenant with no schedule **fails open** (keeps trading) — don't leave hours blank by accident

## 4. Branding & storefront

- [ ] Logo / branding uploaded
- [ ] Theme preset chosen (Classic / Bold / etc.)
- [ ] Accent color set
- [ ] Previewed the live storefront at `/r/[slug]` and confirmed it looks right on mobile
- [ ] Custom domain added (if they bought one) — verify it's **Verified** AND active at the edge
- [ ] If apex domain, confirm the `www` twin is registered too

## 5. Payments (Stripe)

- [ ] Stripe Connect completed for the restaurant's account
- [ ] Confirmed payment mode is **LIVE** (not TEST/STUB — those let customers check out with no money arriving)
- [ ] Placed a small real test order end-to-end and confirmed the charge landed on THEIR connected account
- [ ] Confirmed the surcharge shows as its own disclosed line on the customer receipt
- [ ] Verified the Stripe webhook has **"Listen to events on connected accounts"** enabled
- [ ] Refunded the test order and confirmed it processed

## 6. Plan & billing

- [ ] Correct plan set (ZERO = fee on customer; FLAT $399; HYBRID $149 + 4% from restaurant)
- [ ] Owner understands who pays the fee on their plan
- [ ] Subscription/billing set up on the platform account (FLAT/HYBRID)
- [ ] Sales-tax rate entered by owner

## 7. Messaging (SMS / Email)

- [ ] Confirmed SMS provider status (still gated on A2P 10DLC registration — set expectations that texts may not send yet)
- [ ] Explained consent rules: SMS is opt-in (collected at checkout only), email is opt-out
- [ ] If importing a customer list, confirmed owner understands it grants **no** messaging consent
- [ ] Sender/from details configured

## 8. Go-live check

- [ ] Onboarding completion gate cleared (basics + menu + hours all green)
- [ ] Placed one full test order as a customer, tracked it on `/o/[token]`, and worked it through the order board
- [ ] Owner walked through the order board and knows how to accept / reject / refund
- [ ] QR code / storefront link handed to owner
- [ ] Onboarding call **attended** (not just booked)

## 9. Post-launch follow-up

- [ ] Checked back after first day of real orders
- [ ] Confirmed order notifications are reaching customers
- [ ] Answered any questions and pointed owner to the help center

---

**Notes:**
