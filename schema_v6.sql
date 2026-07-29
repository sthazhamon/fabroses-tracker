-- FabRoses tracking system — Schema migration v6
-- Purchase orders (order material -> receive against that order), an edit
-- audit log (so records can be corrected without losing accountability),
-- richer work order fields (detailed instructions, output SKU link, labor
-- cost), and a link from material batches back to the purchase order that
-- brought them in.
--
-- Run AFTER schema_v5.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v6.sql --remote

-- ---------------- Purchase orders (procurement, distinct from job-work) ----------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,               -- PO-000001
  supplier_name TEXT NOT NULL,
  material_id INTEGER REFERENCES materials(id),
  metres_ordered REAL NOT NULL,
  rate_per_metre REAL,
  expected_date TEXT,
  status TEXT DEFAULT 'ordered',     -- ordered | partially_received | received | cancelled
  metres_received REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE material_batches ADD COLUMN purchase_order_id TEXT REFERENCES purchase_orders(id);

-- ---------------- Richer work orders ----------------
ALTER TABLE work_orders ADD COLUMN work_instructions TEXT;   -- detailed brief, separate from the short description
ALTER TABLE work_orders ADD COLUMN labor_cost REAL;          -- optional, entered when receiving the finished piece back
ALTER TABLE work_orders ADD COLUMN output_product_id TEXT REFERENCES products(id);
-- output_product_id is deliberately separate from the existing product_id column:
-- product_id (added in v4) means "fulfilled from this catalog item's stock" for
-- catalog-type orders. output_product_id means "this work order's finished
-- result became this SKU" — the two are different directions of the same
-- relationship and can both be set on the same order in principle.

-- ---------------- Edit audit log ----------------
-- Every correction to a financial or order record gets one row here, before
-- the value changes. Nothing is ever silently overwritten without a trace.
CREATE TABLE IF NOT EXISTS edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,   -- sale | purchase | expense | work_order | party
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edited_by TEXT,
  edited_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_editlog_entity ON edit_log(entity_type, entity_id);
