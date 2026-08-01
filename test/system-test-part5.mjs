// Fifth pass: part-numbering and the full customer order fulfillment engine.
// Run with: node test/system-test-part5.mjs

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
for (const f of ["schema.sql", "schema_v2.sql", "schema_v3.sql", "schema_v4.sql", "schema_v5.sql", "schema_v6.sql", "schema_v7.sql", "schema_v8.sql"]) {
  sqliteDb.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
}
const env = { DB: wrapD1(sqliteDb), PHOTOS: makeFakeR2(), AUTH_SECRET: "test-secret" };
function req(body) { return { json: async () => body }; }

async function run() {
  section("=== Part-numbering master lists: seeded and extendable ===");
  const catMod = await import("../functions/api/item-categories.js");
  const fabMod = await import("../functions/api/item-fabrics.js");
  const workMod = await import("../functions/api/item-worktypes.js");
  const patMod = await import("../functions/api/item-patterns.js");

  const seededCats = await (await catMod.onRequestGet({ env })).json();
  assert(seededCats.length === 8 && seededCats.some((c) => c.code === "CTW"), "categories came pre-seeded from the real site (8 entries, Cutwork present)");

  const newFabric = await (await fabMod.onRequestPost({ request: req({ name: "Chiffon" }), env })).json();
  assert(newFabric.code === "CHI", `a brand-new fabric not in the seed list gets a sensible auto-suggested code (got ${newFabric.code})`);

  const dupFabric = await (await fabMod.onRequestPost({ request: req({ name: "Kota" }), env })).json();
  assert(dupFabric.error, "adding a fabric name that already exists is rejected, not silently duplicated");

  section("=== Part number generation on a new catalog item ===");
  const productsMod = await import("../functions/api/products.js");
  const cats = await (await catMod.onRequestGet({ env })).json();
  const fabs = await (await fabMod.onRequestGet({ env })).json();
  const works = await (await workMod.onRequestGet({ env })).json();
  const pats = await (await patMod.onRequestGet({ env })).json();
  const ctwCat = cats.find((c) => c.code === "CTW");
  const ktaFab = fabs.find((f) => f.code === "KTA");
  const aplWork = works.find((w) => w.code === "APL");
  const flrPat = pats.find((p) => p.code === "FLR");

  const prod1 = await (await productsMod.onRequestPost({
    request: req({ name: "First Item", category_id: ctwCat.id, fabric_id: ktaFab.id, work_type_id: aplWork.id, pattern_id: flrPat.id, stock_qty: 5 }), env,
  })).json();
  assert(prod1.item_code === "FR-CTW-KTA-APL-FLR-0001", `first item in this exact combination gets sequence 0001 (got ${prod1.item_code})`);

  const prod2 = await (await productsMod.onRequestPost({
    request: req({ name: "Second Item, same combo", category_id: ctwCat.id, fabric_id: ktaFab.id, work_type_id: aplWork.id, pattern_id: flrPat.id, stock_qty: 3 }), env,
  })).json();
  assert(prod2.item_code === "FR-CTW-KTA-APL-FLR-0002", `a second item in the SAME combination correctly increments to 0002 (got ${prod2.item_code})`);

  const prodNoCode = await (await productsMod.onRequestPost({ request: req({ name: "Plain product, no coding" }), env })).json();
  assert(prodNoCode.item_code === null, "a product created without the four dimensions simply has no item_code — this stays entirely optional");

  section("=== Fulfillment cascade, branch A: enough stock right now ===");
  const coMod = await import("../functions/api/customer-orders.js");
  const order1 = await (await coMod.onRequestPost({ request: req({ customer_name: "Anu Varghese", product_id: prod1.id, quantity: 2 }), env, data: {} })).json();
  assert(order1.status === "stock_available", `ordering 2 units when 5 are in stock correctly resolves to stock_available (got ${order1.status})`);
  assert(!order1.needs_material, "no material-send trigger needed for a stock-available order");

  section("=== Fulfillment cascade, branch B: insufficient stock, but a matching WIP already exists ===");
  const workordersMod = await import("../functions/api/workorders.js");
  const existingWO = await (await workordersMod.onRequestPost({
    request: req({ description: "Already making more of prod2", intended_product_id: prod2.id }), env,
  })).json();
  const order2 = await (await coMod.onRequestPost({ request: req({ customer_name: "Jisha Paul", product_id: prod2.id, quantity: 10 }), env, data: {} })).json();
  assert(order2.status === "awaiting_wip" && order2.linked_work_order_id === existingWO.id,
    `ordering more than in stock (10 vs 3) correctly attaches to the ALREADY-OPEN work order rather than creating a redundant new one (got status=${order2.status}, linked=${order2.linked_work_order_id})`);

  const woCountAfterOrder2 = await env.DB.prepare("SELECT COUNT(*) AS c FROM work_orders").first();

  section("=== Fulfillment cascade, branch C: insufficient stock, NOTHING in progress — triggers a brand new work order ===");
  const order3 = await (await coMod.onRequestPost({ request: req({ customer_name: "Reshma Nair", product_id: prod1.id, quantity: 6 }), env, data: {} })).json();
  assert(order3.status === "awaiting_material" && order3.needs_material === true,
    `ordering more than exists (6 vs 5 in stock, nothing in progress) correctly triggers awaiting_material with needs_material flagged (got ${order3.status})`);
  assert(order3.linked_work_order_id, "a brand new work order was actually created and linked");

  const woCountAfterOrder3 = await env.DB.prepare("SELECT COUNT(*) AS c FROM work_orders").first();
  assert(woCountAfterOrder3.c === woCountAfterOrder2.c + 1, "exactly one new work order was created for branch C (not zero, not duplicated)");

  section("=== Fully custom order with no catalog match at all ===");
  const order4 = await (await coMod.onRequestPost({ request: req({ customer_name: "Merin Jose", description: "Fully custom blue silk saree with peacock zardozi" }), env, data: {} })).json();
  assert(order4.status === "awaiting_material" && order4.linked_work_order_id, "a fully custom order (no product_id at all) skips stock/WIP checks entirely and goes straight to a new work order");

  section("=== Auto-attach: receiving the linked work order flips the order to ready_to_bill ===");
  const receiveMod = await import("../functions/api/workorders/[id]/receive.js");
  await receiveMod.onRequestPost({ request: req({ product_id: prod1.id, quantity: 5 }), env, params: { id: order3.linked_work_order_id }, data: { user: {} } });

  const order3After = await env.DB.prepare("SELECT * FROM customer_orders WHERE id = ?").bind(order3.id).first();
  assert(order3After.status === "ready_to_bill", `receiving the finished good against order3's work order correctly flips ITS status to ready_to_bill (got ${order3After.status})`);

  const order1Unaffected = await env.DB.prepare("SELECT * FROM customer_orders WHERE id = ?").bind(order1.id).first();
  assert(order1Unaffected.status === "stock_available", "a DIFFERENT, unrelated order (order1) is untouched by that receipt — no cross-contamination between orders");

  section("=== Billing: re-checks stock at the actual moment of billing ===");
  const billMod = await import("../functions/api/customer-orders/[id]/bill.js");
  const bill1 = await (await billMod.onRequestPost({ request: req({ sale_price: 4000, amount_received: 4000 }), env, params: { id: order1.id } })).json();
  assert(bill1.ok && bill1.sale_id, "billing a stock_available order succeeds and produces a real sale record");

  const prod1AfterBill1 = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod1.id).first();
  // prod1 started at 5, then gained 5 more from receiving order3's work order (above), then lost 2 to this sale: 5 + 5 - 2 = 8.
  assert(prod1AfterBill1.stock_qty === 8, `billing order1 (2 units) correctly decremented stock after the earlier WO receipt added 5 (5+5-2=8, got ${prod1AfterBill1.stock_qty})`);

  const doubleBill = await (await billMod.onRequestPost({ request: req({ sale_price: 100 }), env, params: { id: order1.id } })).json();
  assert(doubleBill.error, "attempting to bill an already-billed order is rejected — no double-billing");

  const bill3 = await (await billMod.onRequestPost({ request: req({ sale_price: 50000 }), env, params: { id: order3.id } })).json();
  assert(bill3.ok, `billing order3 (6 units, stock now at 8) succeeds since enough was actually produced (error if any: ${bill3.error})`);

  const notEnoughOrder = await (await coMod.onRequestPost({ request: req({ customer_name: "Test Race Condition", product_id: prod2.id, quantity: 5 }), env, data: {} })).json();
  assert(notEnoughOrder.status === "awaiting_wip", `prod2 only has 3 in stock and its WO is still open, so requesting 5 correctly attaches to that WIP rather than stock_available (got ${notEnoughOrder.status})`);
  const billBeforeReady = await (await billMod.onRequestPost({ request: req({ sale_price: 1000 }), env, params: { id: notEnoughOrder.id } })).json();
  assert(billBeforeReady.error, "billing an order that's still awaiting_wip (its work order was never received) is correctly rejected — there's genuinely no stock to sell yet");

  section("=== Shipping only after billing ===");
  const shipMod = await import("../functions/api/customer-orders/[id]/ship.js");
  const shipBeforeBillOrder = await (await coMod.onRequestPost({ request: req({ customer_name: "Test", description: "Custom" }), env, data: {} })).json();
  const shipTooEarly = await (await shipMod.onRequestPost({ request: req({ courier: "DTDC", tracking_id: "T1" }), env, params: { id: shipTooEarlyId(shipBeforeBillOrder) } })).json();
  assert(shipTooEarly.error, "shipping an order that hasn't been billed yet is rejected");

  const ship1 = await (await shipMod.onRequestPost({ request: req({ courier: "Delhivery", tracking_id: "TRK998877" }), env, params: { id: order1.id } })).json();
  assert(ship1.ok, "shipping a billed order succeeds");

  const order1Final = await env.DB.prepare("SELECT * FROM customer_orders WHERE id = ?").bind(order1.id).first();
  assert(order1Final.status === "shipped" && order1Final.tracking_id === "TRK998877", "the order now shows shipped status with the tracking id attached — this closes the loop end to end");

  section("=== Cancellation rules ===");
  const cancelMod = await import("../functions/api/customer-orders/[id].js");
  const cancelOk = await (await cancelMod.onRequestPatch({ request: req({ status: "cancelled" }), env, params: { id: order4.id } })).json();
  assert(cancelOk.ok, "an order that's just sitting in production can be cancelled");

  const cancelShipped = await (await cancelMod.onRequestPatch({ request: req({ status: "cancelled" }), env, params: { id: order1.id } })).json();
  assert(cancelShipped.error, "an already-shipped order cannot be cancelled after the fact");

  section("=== Full detail view assembles order + work order + sale correctly ===");
  const detail = await (await cancelMod.onRequestGet({ params: { id: order3.id }, env })).json();
  assert(detail.work_order && detail.work_order.stages.length > 0, "customer order detail includes the linked work order's full stage history");
  assert(detail.sale && detail.sale.sale_price === 50000, "customer order detail includes the sale it eventually became");

  section("=== Summary ===");
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

function shipTooEarlyId(order) { return order.id; }

run().catch((e) => { console.error("TEST HARNESS CRASHED:", e); process.exit(1); });
