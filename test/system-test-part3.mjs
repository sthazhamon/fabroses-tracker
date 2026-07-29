// Third pass: purchase orders, record editing + audit trail, the two
// explicitly-flagged traceability corner cases (one WO fed by multiple
// batches, one batch feeding multiple WOs), and SKU cost roll-up correctness.
// Run with: node test/system-test-part3.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { wrapD1, makeFakeR2 } from "./d1-shim.mjs";

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failed++; console.log(`  \x1b[31m✗ FAIL\x1b[0m ${label}`); }
}
function section(title) { console.log(`\n${title}`); }

const sqliteDb = new DatabaseSync(":memory:");
for (const f of ["schema.sql", "schema_v2.sql", "schema_v3.sql", "schema_v4.sql", "schema_v5.sql", "schema_v6.sql"]) {
  sqliteDb.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
}
const env = { DB: wrapD1(sqliteDb), PHOTOS: makeFakeR2(), AUTH_SECRET: "test-secret" };
function req(body) { return { json: async () => body }; }

async function run() {
  section("=== Purchase orders: order material, then receive against it ===");
  const materialsMod = await import("../functions/api/materials.js");
  const mat = await (await materialsMod.onRequestPost({ request: req({ name: "Kota Organza" }), env })).json();

  const poMod = await import("../functions/api/purchase-orders.js");
  const poReceiveMod = await import("../functions/api/purchase-orders/[id]/receive.js");

  const poRes = await (await poMod.onRequestPost({
    request: req({ supplier_name: "Neelam Fabrics", material_id: mat.id, metres_ordered: 100, rate_per_metre: 240 }), env,
  })).json();
  assert(poRes.id === "PO-000001", "created purchase order PO-000001");

  const overReceive = await (await poReceiveMod.onRequestPost({ request: req({ metres_received: 150 }), env, params: { id: poRes.id } })).json();
  assert(overReceive.error, "rejects receiving more than was ordered");

  const partialReceive = await (await poReceiveMod.onRequestPost({ request: req({ metres_received: 40, purchase_amount: 9600 }), env, params: { id: poRes.id } })).json();
  assert(partialReceive.batch_id === "RM-000001" && partialReceive.po_status === "partially_received", "first partial receipt creates RM-000001, PO correctly shows partially_received");

  const poAfterPartial = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id = ?").bind(poRes.id).first();
  assert(poAfterPartial.metres_received === 40, "PO tracks 40m received so far out of 100m ordered");

  const batchLinkedToPO = await env.DB.prepare("SELECT * FROM material_batches WHERE id = ?").bind("RM-000001").first();
  assert(batchLinkedToPO.purchase_order_id === poRes.id, "the created batch correctly links back to the purchase order that brought it in");

  const finalReceive = await (await poReceiveMod.onRequestPost({ request: req({ metres_received: 60, purchase_amount: 14400 }), env, params: { id: poRes.id } })).json();
  assert(finalReceive.po_status === "received", "second receipt completes the order — status flips to received");

  const overNowClosed = await (await poReceiveMod.onRequestPost({ request: req({ metres_received: 1 }), env, params: { id: poRes.id } })).json();
  assert(overNowClosed.error, "rejects any further receipt once the PO is already fully received");

  section("=== Corner case 1: ONE work order fed by TWO different material batches ===");
  const workordersMod = await import("../functions/api/workorders.js");
  const issueMod = await import("../functions/api/workorders/[id]/issue-material.js");

  const wo1 = await (await workordersMod.onRequestPost({
    request: req({ description: "Heavy embroidery saree", work_instructions: "Full pallu zardozi work, gold thread, peacock motif per attached sketch" }), env,
  })).json();

  await issueMod.onRequestPost({ request: req({ material_batch_id: "RM-000001", metres: 10, worker_name: "Zakir" }), env, params: { id: wo1.id }, data: { user: {} } });
  await issueMod.onRequestPost({ request: req({ material_batch_id: "RM-000002", metres: 8, worker_name: "Zakir" }), env, params: { id: wo1.id }, data: { user: {} } });

  const wo1Detail = await (await (await import("../functions/api/workorders/[id].js")).onRequestGet({ params: { id: wo1.id }, env })).json();
  assert(wo1Detail.issues.length === 2 && wo1Detail.work_instructions.includes("zardozi"),
    "WO-000001 correctly shows two separate material issues from two different batches, plus the detailed work instructions saved");

  section("=== Corner case 2: ONE material batch issued to TWO different work orders ===");
  const wo2 = await (await workordersMod.onRequestPost({ request: req({ description: "Matching blouse from the same lot" }), env })).json();
  await issueMod.onRequestPost({ request: req({ material_batch_id: "RM-000001", metres: 5, worker_name: "Mortaja" }), env, params: { id: wo2.id }, data: { user: {} } });

  const batch1IssuesAcrossWOs = await env.DB.prepare("SELECT DISTINCT work_order_id FROM material_issues WHERE material_batch_id = 'RM-000001'").all();
  assert(batch1IssuesAcrossWOs.results.length === 2, "RM-000001 shows as issued to BOTH WO-000001 and WO-000002 — same batch, two different orders, both tracked");

  const batch1AfterBothIssues = await env.DB.prepare("SELECT metres_balance FROM material_batches WHERE id = 'RM-000001'").first();
  assert(batch1AfterBothIssues.metres_balance === 25, "RM-000001's balance correctly reflects BOTH issues combined (40 - 10 - 5 = 25)");

  section("=== Receiving with a real SKU: description, price, cost, labor cost, multiple pieces over time ===");
  const receiveMod = await import("../functions/api/workorders/[id]/receive.js");
  const receive1 = await (await receiveMod.onRequestPost({
    request: req({
      new_product_name: "Peacock Zardozi Silk Saree", category: "Saree", description: "Hand embroidered, gold thread peacock motif",
      price: 8500, quantity: 1, labor_cost: 1200,
    }), env, params: { id: wo1.id }, data: { user: { name: "tester" } },
  })).json();
  assert(receive1.ok, "received WO-000001's finished good with full SKU detail");

  const productAfter1 = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(receive1.product_id).first();
  assert(productAfter1.description.includes("peacock motif") && productAfter1.price === 8500, "the new SKU carries the real description and price given at receiving time, not a placeholder");

  section("=== SKU cost roll-up: correctly attributes only the metres each WO actually used ===");
  const costMod = await import("../functions/api/products/[id]/cost.js");
  const cost1 = await (await costMod.onRequestGet({ params: { id: receive1.product_id }, env })).json();
  // WO-000001 used 10m of RM-000001 (240/m) + 8m of RM-000002 (240/m) = 2400 + 1920 = 4320 raw cost
  assert(cost1.total_raw_material_cost === 4320, `raw material cost correctly sums across both batches used by this WO (expected 4320, got ${cost1.total_raw_material_cost})`);
  assert(cost1.total_labor_cost === 1200, "labor cost correctly included");
  assert(cost1.total_cost === 5520, "total cost = raw + labor, correctly combined");
  assert(cost1.cost_per_unit === 5520, "cost per unit correct for a single-piece run");
  assert(cost1.margin_per_unit === 8500 - 5520, "margin correctly computed against the selling price");
  assert(cost1.work_orders[0].materials.length === 2, "cost breakdown shows both material lines for this work order, not just one");

  section("=== Same SKU, a second work order feeding it later — cost roll-up must NOT double count the other WO's batch ===");
  const receive2 = await (await receiveMod.onRequestPost({
    request: req({ product_id: receive1.product_id, quantity: 1, labor_cost: 900 }),
    env, params: { id: wo2.id }, data: { user: {} },
  })).json();
  const cost2 = await (await costMod.onRequestGet({ params: { id: receive1.product_id }, env })).json();
  // WO-000002 used 5m of RM-000001 (240/m) = 1200 raw cost. Combined with WO-000001's 4320 = 5520 total raw.
  assert(cost2.total_raw_material_cost === 4320 + 1200, `combined raw cost across both work orders feeding this SKU is correct (expected 5520, got ${cost2.total_raw_material_cost})`);
  assert(cost2.total_units_produced === 2, "total units produced across both work orders is 2");
  assert(cost2.work_orders.length === 2, "cost breakdown lists both contributing work orders separately, fully traceable");

  section("=== Editing records: sales, with ledger sync and audit trail ===");
  const salesMod = await import("../functions/api/sales.js");
  const saleRes = await (await salesMod.onRequestPost({ request: req({ description: "Original desc", sale_price: 1000, customer_name: "Test Cust" }), env })).json();

  const salesEditMod = await import("../functions/api/sales/[id].js");
  await salesEditMod.onRequestPatch({ request: req({ sale_price: 1500, description: "Corrected price" }), env, params: { id: saleRes.id }, data: { user: { name: "Accountant Priya" } } });

  const saleAfterEdit = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(saleRes.id).first();
  assert(saleAfterEdit.sale_price === 1500 && saleAfterEdit.description === "Corrected price", "sale record itself was actually updated");

  const ledgerRowAfterEdit = await env.DB.prepare("SELECT * FROM ledger_transactions WHERE type = 'sale' AND reference_id = ?").bind(saleRes.id).first();
  assert(ledgerRowAfterEdit.amount === 1500, "the ledger's mirror of this sale updated too — P&L won't silently go stale after an edit");

  const editLogRows = await env.DB.prepare("SELECT * FROM edit_log WHERE entity_type = 'sale' AND entity_id = ?").bind(saleRes.id).all();
  assert(editLogRows.results.length === 2, "exactly 2 edit_log rows created (sale_price change + description change)");
  const priceEditRow = editLogRows.results.find((r) => r.field === "sale_price");
  assert(priceEditRow.old_value === "1000" && priceEditRow.new_value === "1500" && priceEditRow.edited_by === "Accountant Priya",
    "the audit log correctly shows old value, new value, and who made the change");

  const noOpEdit = await (await salesEditMod.onRequestPatch({ request: req({}), env, params: { id: saleRes.id }, data: { user: {} } })).json();
  assert(noOpEdit.error, "editing with no fields at all is rejected");

  const editMissingSale = await (await salesEditMod.onRequestPatch({ request: req({ sale_price: 99 }), env, params: { id: "SALE-999999" }, data: { user: {} } })).json();
  assert(editMissingSale.error, "editing a sale that doesn't exist 404s cleanly");

  section("=== Editing records: purchases, expenses, parties, work orders — each syncs correctly ===");
  const purchasesMod = await import("../functions/api/purchases.js");
  const purchasesEditMod = await import("../functions/api/purchases/[id].js");
  const purRes = await (await purchasesMod.onRequestPost({ request: req({ supplier_name: "X", amount: 500 }), env })).json();
  await purchasesEditMod.onRequestPatch({ request: req({ amount: 750 }), env, params: { id: purRes.id }, data: { user: {} } });
  const purLedgerRow = await env.DB.prepare("SELECT * FROM ledger_transactions WHERE type='purchase' AND reference_id=?").bind(purRes.id).first();
  assert(purLedgerRow.amount === 750, "purchase edit correctly synced to the ledger");

  const expensesMod = await import("../functions/api/expenses.js");
  const expensesEditMod = await import("../functions/api/expenses/[id].js");
  const expRes = await (await expensesMod.onRequestPost({ request: req({ description: "Rent", amount: 3000 }), env })).json();
  await expensesEditMod.onRequestPatch({ request: req({ amount: 3200 }), env, params: { id: expRes.id }, data: { user: {} } });
  const expLedgerRow = await env.DB.prepare("SELECT * FROM ledger_transactions WHERE type='expense' AND reference_id=?").bind(expRes.id).first();
  assert(expLedgerRow.amount === 3200, "expense edit correctly synced to the ledger");

  const partiesMod = await import("../functions/api/parties.js");
  const partiesEditMod = await import("../functions/api/parties/[id].js");
  const ptyRes = await (await partiesMod.onRequestPost({ request: req({ name: "Edit Test Party", type: "customer", opening_balance: 100 }), env })).json();
  await partiesEditMod.onRequestPatch({ request: req({ opening_balance: 250, phone: "9999999999" }), env, params: { id: ptyRes.id }, data: { user: {} } });
  const partyAfterEdit = await env.DB.prepare("SELECT * FROM parties WHERE id = ?").bind(ptyRes.id).first();
  assert(partyAfterEdit.opening_balance === 250 && partyAfterEdit.phone === "9999999999", "party edit persisted correctly");

  const woEditMod = await import("../functions/api/workorders/[id].js");
  await woEditMod.onRequestPatch({ request: req({ due_date: "2026-09-01", priority: "urgent" }), env, params: { id: wo2.id }, data: { user: {} } });
  const woAfterEdit = await env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(wo2.id).first();
  assert(woAfterEdit.due_date === "2026-09-01" && woAfterEdit.priority === "urgent", "work order edit persisted correctly");

  section("=== Summary ===");
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS CRASHED:", e); process.exit(1); });
