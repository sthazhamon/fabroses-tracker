-- FabRoses tracking system — Schema migration v4 (catalog, party ledger, order lifecycle)
-- Run AFTER schema_v3.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v4.sql --remote

-- Product catalog — a real SKU-style item, not just a free-text description on an order.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,              -- PRD-000001
  name TEXT NOT NULL,
  category TEXT,                    -- e.g. Saree, Blouse, Kids wear, Custom stitching
  color TEXT,
  price REAL,
  cost REAL,
  stock_qty INTEGER DEFAULT 0,      -- ready-made stock on hand, independent of custom work orders
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT REFERENCES products(id),
  r2_key TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Payments — separate from the sale/purchase record itself, so partial and later
-- payments against an existing invoice/bill can be logged over time (matches how
-- the old Ac sheet tracked running Debit/Credit/Balance-to-pay per party).
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,               -- PAY-000001
  party_name TEXT NOT NULL,
  direction TEXT NOT NULL,           -- 'in' (customer/reseller paying us) | 'out' (us paying a supplier)
  amount REAL NOT NULL,
  payment_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_name);

-- Richer order lifecycle: due dates and priority so the dashboard can flag what's
-- actually overdue, not just "sitting in Packed too long"; order_type distinguishes
-- a custom/bespoke piece from one sold straight out of the catalog; product_id links
-- an order back to a catalog item when relevant.
ALTER TABLE work_orders ADD COLUMN due_date TEXT;
ALTER TABLE work_orders ADD COLUMN order_type TEXT DEFAULT 'custom';   -- custom | catalog
ALTER TABLE work_orders ADD COLUMN priority TEXT DEFAULT 'normal';     -- normal | urgent
ALTER TABLE work_orders ADD COLUMN product_id TEXT REFERENCES products(id);
