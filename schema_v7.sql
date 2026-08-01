-- FabRoses tracking system — Schema migration v7
-- Closes the final gap in the traceability chain: a sale can now link to a
-- specific catalog item and quantity, and actually decrements its stock —
-- previously, recording a sale didn't touch inventory at all.
--
-- Run AFTER schema_v6.sql, with:
-- wrangler d1 execute fabroses-db --file=./schema_v7.sql --remote

ALTER TABLE sales ADD COLUMN product_id TEXT REFERENCES products(id);
ALTER TABLE sales ADD COLUMN quantity INTEGER DEFAULT 1;
