-- FabRoses tracking system — Schema migration v2 (Phase 2 & 3)
-- Run AFTER schema.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v2.sql --remote

ALTER TABLE work_orders ADD COLUMN courier TEXT;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,              -- admin | accountant | worker | dispatch | reseller
  reseller_name TEXT,              -- only set for role = 'reseller'; must match reseller_name used on orders
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed one admin login. PIN is 1234 — change this immediately after first login (Users tab).
INSERT INTO users (name, pin, role) VALUES ('Admin', '1234', 'admin');

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,              -- SALE-000001
  work_order_id TEXT REFERENCES work_orders(id),
  description TEXT NOT NULL,
  customer_name TEXT,
  reseller_name TEXT,
  sale_price REAL NOT NULL,
  amount_received REAL DEFAULT 0,
  sale_date TEXT,
  received_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,              -- PUR-000001
  supplier_name TEXT,
  amount REAL NOT NULL,
  amount_paid REAL DEFAULT 0,
  paid_by TEXT,
  description TEXT,
  purchase_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,              -- EXP-000001
  date TEXT,
  description TEXT,
  category TEXT,
  paid_by TEXT,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  type TEXT,                        -- sale | purchase | expense
  reference_id TEXT,
  party TEXT,
  amount REAL,
  direction TEXT,                   -- credit | debit
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_reseller ON sales(reseller_name);
CREATE INDEX IF NOT EXISTS idx_workorders_reseller ON work_orders(reseller_name);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_transactions(date);
