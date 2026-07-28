-- FabRoses tracking system — D1 schema (Phase 1)
-- Run with: wrangler d1 execute fabroses-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT,
  code TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Raw material lots/rolls. id (e.g. RM-000123) is the value encoded in the QR label.
CREATE TABLE IF NOT EXISTS material_batches (
  id TEXT PRIMARY KEY,
  material_id INTEGER REFERENCES materials(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  metres_received REAL,
  metres_balance REAL,
  purchase_amount REAL,
  purchase_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Orders / work-in-progress pieces. id (e.g. WO-000045) is the value encoded in the QR label.
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  order_date TEXT,
  customer_name TEXT,
  reseller_name TEXT,
  description TEXT,
  worker_id INTEGER REFERENCES workers(id),
  material_batch_id TEXT REFERENCES material_batches(id),
  metres_used REAL,
  stage TEXT DEFAULT 'Order Placed',
  dispatch_date TEXT,
  tracking_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT REFERENCES work_orders(id),
  stage TEXT,
  changed_by TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,     -- 'batch' or 'work_order'
  entity_id TEXT NOT NULL,
  stage TEXT,
  r2_key TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_stagelog_wo ON stage_log(work_order_id);
