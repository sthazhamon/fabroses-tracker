-- FabRoses tracking system — Schema migration v8
-- Part-numbering master lists (category/fabric/work-type/pattern, each with a
-- 3-character alphanumeric code you control), and the customer order intake +
-- fulfillment engine: stock check -> WIP check -> raw-material trigger ->
-- auto-attach on receipt -> bill -> ship.
--
-- Run AFTER schema_v7.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v8.sql --remote

-- ---------------- Part-numbering master lists ----------------
-- Each list is small and store-managed: add a new fabric/pattern/etc whenever
-- you need one, pick or edit its 3-character code, and it's immediately
-- available everywhere. No fixed, hardcoded set to run out of.

CREATE TABLE IF NOT EXISTS item_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,   -- 3-character alphanumeric, e.g. CTW
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_fabrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_work_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed starting lists from your actual site + spreadsheet history. Add more
-- anytime through the app — these are just a running start, not a fixed set.
INSERT INTO item_categories (name, code) VALUES
  ('Cutwork', 'CTW'), ('Embroidery', 'EMB'), ('Handwork', 'HWK'),
  ('Kerala', 'KER'), ('Party Wear', 'PTY'), ('Dress Material', 'DRM'),
  ('Daily Wear', 'DLY'), ('Custom / Bespoke', 'CUS');

INSERT INTO item_fabrics (name, code) VALUES
  ('Kota', 'KTA'), ('Organza', 'ORG'), ('Linen', 'LIN'),
  ('Semi Silk', 'SSK'), ('Silk', 'SLK'), ('Kasavu Cotton', 'KAS');

INSERT INTO item_work_types (name, code) VALUES
  ('Cutwork', 'CTW'), ('Embroidery', 'EMB'), ('Applique', 'APL'),
  ('Floral-work', 'FLW'), ('Handwork', 'HDW'), ('Plain / none', 'PLN');

INSERT INTO item_patterns (name, code) VALUES
  ('Floral', 'FLR'), ('Peacock / bird motif', 'PEA'), ('Paisley', 'PAI'),
  ('Geometric', 'GEO'), ('Border only', 'BRD'), ('Traditional', 'TRD'),
  ('Mixed / combination', 'MIX'), ('Other', 'OTH');

-- Link a catalog product to these four dimensions, and store the derived
-- human-readable part number alongside the internal PRD-xxxxx id (which stays
-- as the stable key everything else references — nothing about existing
-- foreign keys changes).
ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES item_categories(id);
ALTER TABLE products ADD COLUMN fabric_id INTEGER REFERENCES item_fabrics(id);
ALTER TABLE products ADD COLUMN work_type_id INTEGER REFERENCES item_work_types(id);
ALTER TABLE products ADD COLUMN pattern_id INTEGER REFERENCES item_patterns(id);
ALTER TABLE products ADD COLUMN item_code TEXT;   -- e.g. FR-CTW-KTA-APL-FLR-0001

-- ---------------- Customer order intake + fulfillment engine ----------------
-- A customer order is deliberately its own thing — distinct from `sales`
-- (which represents money actually collected) and from `work_orders` (which
-- represents production). This is what lets the store log a request the
-- moment it comes in, before it's necessarily in stock, in progress, or
-- billed, and then track it through however it actually gets fulfilled.

-- A work order can be created specifically to replenish a known catalog item
-- — this is what lets the fulfillment engine recognize "someone's already
-- making more of this" before falling back to triggering a brand new one.
ALTER TABLE work_orders ADD COLUMN intended_product_id TEXT REFERENCES products(id);

CREATE TABLE IF NOT EXISTS customer_orders (
  id TEXT PRIMARY KEY,                 -- CO-000001
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  product_id TEXT REFERENCES products(id),   -- the catalog item ordered, if it matches one
  description TEXT,                          -- freeform, for a fully custom/one-off request
  quantity INTEGER DEFAULT 1,
  order_date TEXT,
  promised_delivery_date TEXT,
  -- received: just logged, not yet checked against stock
  -- stock_available: enough in stock right now, ready to bill whenever
  -- awaiting_wip: matched to a work order already in progress for this item
  -- awaiting_material: no stock, no matching WIP — a new work order was just
  --                     triggered and needs raw material issued to a worker
  -- ready_to_bill: the linked work order was received back into stock
  -- billed: a sale has been recorded against this order
  -- shipped: courier/tracking added — this closes the order
  -- cancelled
  status TEXT DEFAULT 'received',
  linked_work_order_id TEXT REFERENCES work_orders(id),
  sale_id TEXT REFERENCES sales(id),
  courier TEXT,
  tracking_id TEXT,
  dispatch_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_product ON customer_orders(product_id);
