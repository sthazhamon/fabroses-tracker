-- FabRoses tracking system — Schema migration v5
-- Adds: a real party master (so you can register a customer/reseller/supplier/
-- worker before any transaction exists), a proper issue-to-worker /
-- receive-finished-good job-work workflow, and an append-only traceability log
-- covering every material movement.
--
-- Run AFTER schema_v4.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v5.sql --remote

-- ---------------- Party master ----------------
-- Previously, "parties" only existed implicitly as free-text names typed into
-- sales/purchases. This is a real master record you can create up front —
-- including an opening balance carried over from your old spreadsheet.
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,               -- PTY-000001
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,                -- customer | reseller | supplier | worker | other
  phone TEXT,
  notes TEXT,
  opening_balance REAL DEFAULT 0,    -- +ve = they owe us, -ve = we owe them
  created_at TEXT DEFAULT (datetime('now'))
);

-- ---------------- Job-work: issue raw material, receive finished good ----------------
-- A material batch's metres_balance already means "still available, unissued,
-- sitting at the store." Issuing material to a worker for a specific work
-- order decrements that balance and creates a tracked, open "with the worker"
-- record — closed out only when the finished good is formally received back.
CREATE TABLE IF NOT EXISTS material_issues (
  id TEXT PRIMARY KEY,               -- ISS-000001
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  material_batch_id TEXT NOT NULL REFERENCES material_batches(id),
  metres_issued REAL NOT NULL,
  worker_name TEXT NOT NULL,
  status TEXT DEFAULT 'with_worker', -- with_worker | received
  issued_at TEXT DEFAULT (datetime('now')),
  received_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_wo ON material_issues(work_order_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON material_issues(status);

ALTER TABLE work_orders ADD COLUMN received_qty REAL;
ALTER TABLE work_orders ADD COLUMN received_at TEXT;

-- ---------------- Traceability log ----------------
-- One append-only row per real-world movement of anything — raw material
-- arriving, being issued to a worker, a finished good coming back, being
-- dispatched. This is the actual answer to "maintain traceability": query
-- this table by work_order_id or item_ref and you get the full chain of
-- custody, in order, permanently — nothing here is ever edited or deleted.
CREATE TABLE IF NOT EXISTS inventory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,           -- raw_material | finished_good
  item_ref TEXT NOT NULL,            -- material_batches.id or products.id
  work_order_id TEXT,
  event TEXT NOT NULL,               -- received_into_store | issued_to_worker | returned_finished_good | dispatched | adjusted
  quantity REAL,
  from_location TEXT,
  to_location TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invlog_wo ON inventory_log(work_order_id);
CREATE INDEX IF NOT EXISTS idx_invlog_item ON inventory_log(item_type, item_ref);
