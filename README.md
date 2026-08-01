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

3. **Load all eight schema files, in this exact order:**
   ```
   wrangler d1 execute fabroses-db --file=./schema.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v2.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v3.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v4.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v5.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v6.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v7.sql --remote
   wrangler d1 execute fabroses-db --file=./schema_v8.sql --remote
   ```
   If you've already run some of these on a previous deployment, only run the
   ones you haven't — each is safe to run once, but re-running one that's
   already applied will error (harmlessly — just skip it and move to the
   next). If you're not sure which ones you've run, check with:
   ```
   wrangler d1 execute fabroses-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
   ```
   and compare against what each schema file creates.

4. **Create the R2 bucket:**
   ```
   wrangler r2 bucket create fabroses-photos
   ```

5. **Bootstrap your first admin login:**
   ```
   node scripts/create-admin.js "Your Name" youradminusername yourSecurePin123
   ```
   This writes a file called `create-admin.sql` in the project folder and
   prints the command to run it:
   ```
   wrangler d1 execute fabroses-db --remote --file=./create-admin.sql
   ```
   Run that exact command. Your PIN is hashed **locally on your machine**
   before it ever touches this file — only the scrambled hash goes into the
   database, never the PIN itself. You can delete `create-admin.sql`
   afterward if you like; it's not sensitive on its own, just tidy-up.

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

- **Purchase Orders** — place an order with a supplier, then receive against
  it (partial deliveries supported). This is the "ordering materials, then
  receiving against the order" half of procurement, separate from job-work.
- **Catalog** — a real product/SKU list with photos. Each item has a **View
  cost** button showing exactly which raw material batches and how much
  labor went into it, and the resulting margin.
- **Floor Status** — what's at the store, what's with each worker.
- **Raw Material** — log a fabric lot directly, or receive it via a Purchase
  Order (recommended, since it keeps the order-to-receipt link intact).
- **Work Order** — now has a dedicated **work instructions** field for
  detailed briefs, and an optional **hand-sketch photo** attached right at
  creation. One order can draw material from multiple different batches, and
  the same batch can feed multiple different orders — both fully supported
  and traceable.
- **Scan** — the job-work control center:
  - **Issue material to a worker** (scan-to-fill the batch code instead of
    typing it)
  - **Receive the finished good** with a real description, price, category,
    and multiple photos — this is what becomes the catalog listing, photos
    included, ready to download for your online store
  - **Edit order details** — due date, priority, and instructions can be
    corrected after creation
  - Full traceability and stage progression, as before
- **Dispatch / Sales / Purchases / Expenses** — each list now has an **Edit**
  button. Editing a sale, purchase, or expense updates the underlying ledger
  entry too, and every change is recorded in an audit log (old value, new
  value, who made the change) — nothing is silently overwritten.
- **Sales** also has a **Print** button — opens a clean, print-ready invoice
  in a new tab (use your browser's Print → Save as PDF for a digital copy).
- **Parties** — add a party directly, with an opening balance; edit their
  details later if needed.
- **Ledger / P&L**, **Dashboard**, **Users** — as before.

## Two things worth understanding about how costing works

- **Cost per SKU** is computed by tracing every work order that fed into
  that product, and for each one, exactly how many metres of which batch(es)
  it used — a batch's cost is spread across every order that drew from it,
  not double-counted. Labor cost is whatever you typed in at the moment of
  receiving (there's no automatic piece-rate calculation).
- **A SKU created by typing a brand-new name at receiving time** starts a
  fresh cost trail from that point on. If you receive a second batch of the
  same design into the *same* existing catalog code later, its cost rolls
  into the same average.

## How an item's identity changes as it moves through the system

This trips people up, so it's worth being explicit: the *code* changes at
each stage, but the *lineage* never breaks.

- **`RM-xxxxx`** — a batch of raw material. Represents a lot, not a single
  item; one batch can feed many pieces.
- **`WO-xxxxx`** — a job. Represents the work being done, with which worker
  and which material.
- **`PRD-xxxxx`** — the catalog SKU. Represents a style/design. Multiple
  physical pieces (even from different work orders) can share one PRD code
  and just add to its stock count — that's normal retail thinking, not a
  limitation.

Every PRD traces back to the exact work order(s) that made it, and every
work order traces back to the exact raw material batch(es) it drew from —
that's what **View cost** on a catalog item is actually showing you.

**Selling a catalog item now actually decrements its stock** (this was
missing before — recording a sale used to leave inventory untouched). In
the Sales tab, scan or type a catalog code and its price/name auto-fill;
leave it blank for a custom or non-catalog sale, which still works exactly
as before.

## Entering existing stock that has no raw-material or work-order history

Two ways, both fine:

- **At creation** — Catalog tab → "Add to catalog" → just set **Stock on
  hand** directly. No work order needed. If you know roughly what it cost
  you, fill in the **Cost** field too — it'll show up honestly in "View
  cost" as manually-entered, rather than being ignored.
- **Later, on an existing item** — each catalog card has an **Adjust stock**
  button. Use a positive number to add (e.g. found more old stock, or
  received extra outside the system) or negative to remove (damaged,
  written off). Every adjustment is permanently logged with a reason.

"View cost" is honest about where its numbers came from — it says whether a
figure is traced from actual work orders, manually entered, or simply not
recorded yet (rather than ever silently reporting a cost of zero, which
would make margin look artificially better than it is).

## Part numbering

Four small, store-managed lists — **Category, Fabric, Work type, Pattern** —
each entry with a 3-character code you control (auto-suggested from the
name, editable before you confirm). Pick all four when adding a catalog
item and the system builds the full part number itself:

```
FR-CTW-KTA-APL-FLR-0001
   |    |    |    |    └─ sequence, restarts per unique combination
   |    |    |    └────── pattern (Floral)
   |    |    └─────────── work type (Applique)
   |    └──────────────── fabric (Kota)
   └───────────────────── category (Cutwork)
```

Add a new fabric, pattern, etc. anytime with the **+ new** button right next
to each dropdown — never blocked waiting for a fixed list to be updated.
Seeded from your actual site's categories and fabrics as a starting point.

This is entirely optional — a product created without picking all four
simply has no part number, and everything else about it works normally.

## Customer order intake and fulfillment

**Customer Orders** is a new tab, separate from both Sales (money collected)
and Work Orders (production) — it's what a customer *wants*, logged the
moment they ask, before it's necessarily in stock or even started.

The moment you log one against a catalog item, the system checks, in order:
1. **Enough in stock right now?** → marked `stock_available`, bill it
   whenever.
2. **Not enough, but something's already being made for this exact item?**
   → attaches to that existing work order (`awaiting_wip`) instead of
   starting a redundant second one.
3. **Neither?** → creates a brand new work order automatically
   (`awaiting_material`) — go to **Scan**, issue raw material to a worker
   for it, same as any other job.

**When that work order's finished good is received back into stock**, any
customer order waiting on it flips to `ready_to_bill` on its own — no manual
step. From there: **Bill** (creates the actual sale, re-checking stock at
that exact moment so two orders can't both claim the last piece) → **Ship**
(adds courier + tracking, closes the order).

A fully custom order with no catalog match skips the stock/WIP checks
entirely and goes straight to production.

**A deliberate design choice worth knowing about:** production stages
(Order Placed → Cutting → Handwork → ... → Delivered) stay on the work
order, worker-facing. The customer order gets its own, coarser status
(received → stock_available/awaiting_wip/awaiting_material → ready_to_bill
→ billed → shipped) — store-facing. The Customer Order detail view shows
both together. This is split into two fields on purpose rather than forced
into one long combined list, since a work order and a customer order aren't
always 1:1 (one work order can eventually satisfy several customer orders
placed against the same design over time).

## Testing this yourself before you trust it with real data

The `test/` folder has real system test suites — they import the actual
`functions/api/*.js` files (the same code that gets deployed) and run them
against a real SQLite database and a fake photo bucket, no live Cloudflare
account needed. Run all three any time you or I change the code:

```
node test/system-test.mjs
node test/system-test-part2.mjs
node test/system-test-part3.mjs
node test/system-test-part4.mjs
node test/system-test-part5.mjs
```

Together they're 163 checks covering the full job-work cycle, purchase
orders, editing records with audit trail, part-numbering generation, the
full customer-order fulfillment cascade (all three branches: stock / WIP /
raw-material-trigger), auto-attach on receipt, billing with a live stock
re-check, shipping, cancellation rules, the sale-to-stock link, every
endpoint's happy path and its error cases, login lockout, and live session
revocation. If any of them ever print a FAIL line, don't deploy that change
until it's resolved.

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
