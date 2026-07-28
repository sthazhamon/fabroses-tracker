# FabRoses Tracker

A raw-material-to-dispatch tracking system for the saree business: QR-tagged
fabric lots and work orders, camera scanning, per-stage photo capture,
dispatch logging, and a sales/purchases/expenses ledger with an auto-computed
P&L. Runs entirely on Cloudflare's free/near-free tier.

## What's included

- `index.html` — the whole frontend (login + all tabs). No build step.
- `functions/api/*` — the backend, as Cloudflare Pages Functions.
- `schema.sql` — Phase 1 database schema (raw material + work orders).
- `schema_v2.sql` — Phase 2/3 additions (sales, purchases, expenses, ledger,
  dispatch fields, a basic users table).
- `schema_v3.sql` — proper login & access control: hashed credentials,
  username-based login, account lockout, session revocation, enable/disable.
  Run this **after** `schema_v2.sql`.
- `scripts/create-admin.js` — bootstraps your very first admin login (the app
  has no way to create one before an admin exists).
- `wrangler.toml` — config for local development and bindings.

## One-time setup

1. **Install Wrangler and log in:**
   ```
   npm install -g wrangler
   wrangler login
   ```

2. **Create the D1 database:**
   ```
   wrangler d1 create fabroses-db
   ```
   Copy the printed `database_id` into `wrangler.toml`.

3. **Load all three schema files, in this exact order:**
   ```
   wrangler d1 execute fabroses-db --file=./schema.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v2.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v3.sql --remote
   ```
   `schema_v3.sql` removes the old plaintext-PIN seed login as part of the
   migration — after this runs, there are **zero** logins in the system.
   That's expected; the next step creates your first one.

4. **Create the R2 bucket:**
   ```
   wrangler r2 bucket create fabroses-photos
   ```

5. **Bootstrap your first admin login:**
   ```
   node scripts/create-admin.js "Your Name" youradminusername yourSecurePin123
   ```
   This prints a `wrangler d1 execute` command — copy it exactly and run it.
   The script computes the password hash **locally on your machine**; your
   PIN is never sent anywhere, only the resulting hash goes into the database.
   You'll then sign in to the app with the username and PIN you chose here.

   From this point on, don't use this script again for day-to-day staff —
   create those logins through the app's **Users** tab once you're signed in.

## Push to GitHub

```
cd fabroses-app
git init
git add .
git commit -m "FabRoses tracker: raw material, WIP, dispatch, ledger, proper auth"
git branch -M main
git remote add origin https://github.com/<your-username>/fabroses-tracker.git
git push -u origin main
```

## Connect to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → select your repo.
2. Build settings: build command **empty**, output directory **`/`**.
3. After the first deploy, go to **Settings → Functions** and add:
   - **D1 database binding** — variable name `DB` → `fabroses-db`
   - **R2 bucket binding** — variable name `PHOTOS` → `fabroses-photos`
   - **Environment variable** — `AUTH_SECRET` → a long random string
     (this signs login sessions; anyone who guesses it could forge a login,
     so don't leave it as `dev-secret-change-me` once you're live)
4. Redeploy (or push a small change) so the bindings take effect.

From then on, every `git push` to `main` auto-deploys.

## How login & access control actually work now

- **Credentials are hashed, not stored in plain text.** PINs go through
  PBKDF2 (50,000 iterations, SHA-256, a unique random salt per user) before
  hitting the database — even someone with direct database access can't read
  anyone's PIN back out.
- **Account lockout.** 5 wrong PIN attempts in a row locks that specific
  account for 15 minutes. The error message is deliberately vague ("Invalid
  username or PIN") so someone probing can't tell whether the username itself
  is even valid.
- **Sessions can be revoked immediately.** Normally a session lasts 12 hours
  once issued. But if a phone is lost or someone leaves, an admin can hit
  **Revoke sessions** on that user in the Users tab and every device they're
  signed into is logged out on their very next request — no waiting for the
  token to expire naturally.
- **Logins can be disabled without deleting them.** Useful for someone on
  leave, or if you want to keep their historical name attached to old orders
  without an active login.
- **Role-based access is enforced server-side**, not just hidden in the UI —
  even if someone inspected the page source, the API itself rejects requests
  outside their role.

None of this is bank-grade security, and it doesn't need to be for an
internal team tool — but it's a real step up from "one shared 4-digit PIN,"
which is where Phase 1 started.

## Roles & what each one can do

| Role | Can do |
|---|---|
| **Admin** | Everything, including creating other logins (Users tab) |
| **Accountant** | Dashboard, Sales, Purchases, Expenses, Ledger/P&L, plus the day-to-day Raw Material / Work Order / Scan tabs |
| **Worker** | Raw Material, Work Order, Scan — logging intake, creating orders, advancing stages, uploading photos |
| **Dispatch** | Scan, Dispatch, Sales, plus Raw Material / Work Order / Scan |
| **Reseller** | Only "My Orders" — their own orders and sales, read-only. When you create this login, the **Reseller name** you set must exactly match the reseller name typed on their orders, or they'll see nothing. |

Sessions last 12 hours, then it asks for the PIN again.

## Day-to-day use

- **Raw Material** — log a fabric lot, attach a photo, get a QR code
  (`RM-000123`). Print and stick it on the roll.
- **Work Order** — create a piece/order the same way (`WO-000045`). If you
  enter the raw material batch it's cut from, the metres used are deducted
  from that batch automatically.
- **Scan** — camera scan (or type the code) to see full history and, for a
  work order, tap through the stages: Order Placed → Cutting → Handwork →
  Stitching → Quality Check → Packed → Dispatched → Delivered. Each tap is
  timestamped. Add a photo at any point.
- **Dispatch** — enter a work order code + courier + tracking ID to close it
  out. Shows up in the dispatch log.
- **Sales** — record what sold, for how much, and how much of that's been
  received. Auto-posts to the ledger.
- **Purchases / Expenses** — same idea, for money going out. Also auto-post
  to the ledger.
- **Ledger / P&L** — every transaction in one list, plus a profit/loss report
  you can run for any date range (leave blank for all-time).
- **Dashboard** — orders pending by stage, WIP by worker, fabric batches
  running low (under 5m — a hardcoded threshold for now), today's sales,
  and orders stuck in "Packed" for more than 3 days.
- **Users** (admin only) — create logins for staff and resellers. Each row
  also has **Revoke sessions** (instant force-logout), **Disable/Enable**
  (turn a login off without deleting it), and **Reset PIN** (if someone
  forgets theirs).

## Installing it as an app on a phone

This is now a proper PWA (Progressive Web App) — it installs like a native
app, gets its own icon on the home screen, and opens full-screen (no browser
address bar).

**On Android (Chrome):**
1. Open the site's URL in Chrome.
2. You'll see an **"Install app on this phone"** button right on the login
   screen — tap it, then confirm. Chrome also shows its own install icon in
   the address bar if you miss that button.
3. It now sits on the home screen/app drawer like any other app.

**On iPhone (Safari):**
iOS doesn't allow apps to trigger their own install prompt, so it's a manual
step — the login screen shows this automatically when opened in Safari:
1. Tap the **Share** icon (square with an arrow) at the bottom of Safari.
2. Tap **Add to Home Screen**.
3. Tap **Add**. It now opens full-screen from the home screen, same as
   Android.

**Note:** it has to be opened in the actual Safari or Chrome browser for
this to work — not inside another app's built-in browser (e.g. tapping the
link from WhatsApp on iPhone opens it in an in-app browser that doesn't
support installing; from there, tap the "..." or share icon and choose
"Open in Safari" first).

Once installed, the app shell (the interface itself) is cached and will open
even with no signal — though scanning/creating records still needs a
connection to actually save anything, since the data lives on Cloudflare's
servers, not the phone.

## What's deliberately not here yet

- Per-material low-stock thresholds (everything uses a flat 5m cutoff right now)
- WhatsApp/SMS alerts for low stock or overdue dispatch (the dashboard shows
  these, but nothing pushes a notification out — that needs a Twilio/WhatsApp
  Business API account, which means its own setup and per-message cost)
- Editing or deleting records once created (everything is append-only/forward-only,
  which is safer for an audit trail but means typos need a manual DB fix via
  `wrangler d1 execute`)
- A proper "ready-made stock" view for items not tied to a custom work order
- Migrating your historical Google Sheets data into this system — that's a
  separate one-time import script, happy to build that next if useful

## If something breaks

Cloudflare dashboard → your Pages project → **Functions** tab shows real-time
logs for every request, including errors — that's the first place to look.
