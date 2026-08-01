// Fourth pass: verifies the sales-to-stock link that was previously missing.
// Run with: node test/system-test-part4.mjs

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
  section("=== Setup: a catalog item with 3 in stock ===");
  const productsMod = await import("../functions/api/products.js");
  const prod = await (await productsMod.onRequestPost({ request: req({ name: "Test Saree", price: 5000, stock_qty: 3 }), env })).json();

  section("=== Selling against catalog stock actually decrements it ===");
  const salesMod = await import("../functions/api/sales.js");
  const sale1 = await (await salesMod.onRequestPost({ request: req({ description: "Sold one", product_id: prod.id, quantity: 1, sale_price: 5000 }), env })).json();
  const productAfterSale1 = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod.id).first();
  assert(productAfterSale1.stock_qty === 2, `stock correctly dropped from 3 to 2 after selling 1 unit (got ${productAfterSale1.stock_qty})`);

  const saleRow1 = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(sale1.id).first();
  assert(saleRow1.product_id === prod.id && saleRow1.quantity === 1, "the sale record itself now shows which catalog item and how many units were sold");

  section("=== Cannot sell more than what's in stock ===");
  const overSell = await (await salesMod.onRequestPost({ request: req({ description: "Too many", product_id: prod.id, quantity: 10, sale_price: 50000 }), env })).json();
  assert(overSell.error && overSell.error.includes("in stock"), "selling more units than exist in stock is rejected with a clear message");

  const productAfterOverSell = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod.id).first();
  assert(productAfterOverSell.stock_qty === 2, "the rejected over-sell did NOT partially decrement stock");

  section("=== Selling the last two units works, and the third correctly fails ===");
  const sale2 = await (await salesMod.onRequestPost({ request: req({ description: "Sold the rest", product_id: prod.id, quantity: 2, sale_price: 10000 }), env })).json();
  assert(sale2.id === "SALE-000002", "second sale succeeded");
  const productNowEmpty = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod.id).first();
  assert(productNowEmpty.stock_qty === 0, "stock correctly reaches exactly 0");

  const sale3Fails = await (await salesMod.onRequestPost({ request: req({ description: "Nothing left", product_id: prod.id, quantity: 1, sale_price: 5000 }), env })).json();
  assert(sale3Fails.error, "with 0 in stock, any further sale against this item is correctly rejected");

  section("=== Editing a sale's quantity is REJECTED if it would oversell, not silently allowed to go negative ===");
  const salesEditMod = await import("../functions/api/sales/[id].js");
  // sale1 holds 1 unit reserved; stock is at 0 (fully sold out via sale1+sale2 above).
  // Bumping sale1 to 2 units would need 1 more unit than currently exists free — must fail.
  const badQtyEdit = await (await salesEditMod.onRequestPatch({ request: req({ quantity: 2 }), env, params: { id: sale1.id }, data: { user: {} } })).json();
  assert(badQtyEdit.error && badQtyEdit.error.includes("in stock"), "increasing a sale's quantity beyond what's actually available is correctly rejected");

  const productAfterRejectedEdit = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod.id).first();
  assert(productAfterRejectedEdit.stock_qty === 0, "the rejected edit left stock exactly where it was (0), no partial/leaked adjustment");

  section("=== Editing a sale's quantity DOWN correctly returns stock, when there's room to do so ===");
  // Reduce sale1 from 1 unit down to... wait, we need a case with room. Sell one more item on a
  // fresh product instead, to isolate this from the sold-out scenario above.
  const prodFresh = await (await productsMod.onRequestPost({ request: req({ name: "Fresh Item", stock_qty: 5 }), env })).json();
  const saleFresh = await (await salesMod.onRequestPost({ request: req({ description: "d", product_id: prodFresh.id, quantity: 2, sale_price: 100 }), env })).json();
  const prodAfterFreshSale = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prodFresh.id).first();
  assert(prodAfterFreshSale.stock_qty === 3, "sanity check: selling 2 of 5 leaves 3");

  await salesEditMod.onRequestPatch({ request: req({ quantity: 1 }), env, params: { id: saleFresh.id }, data: { user: {} } });
  const prodAfterQtyDecrease = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prodFresh.id).first();
  assert(prodAfterQtyDecrease.stock_qty === 4, "reducing the sold quantity from 2 to 1 correctly returned one unit to stock (3 -> 4)");

  section("=== Editing a sale to point at a DIFFERENT catalog item moves stock correctly ===");
  const prod2 = await (await productsMod.onRequestPost({ request: req({ name: "Different Item", price: 2000, stock_qty: 5 }), env })).json();
  await salesEditMod.onRequestPatch({ request: req({ product_id: prod2.id }), env, params: { id: sale1.id }, data: { user: {} } });

  const prod1AfterMove = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod.id).first();
  const prod2AfterMove = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(prod2.id).first();
  assert(prod1AfterMove.stock_qty === 1, "the OLD product got its unit back (0 -> 1) when the sale was reassigned away from it");
  assert(prod2AfterMove.stock_qty === 4, "the NEW product had its unit correctly deducted (5 -> 4) when the sale was reassigned to it");

  section("=== Sales with no product_id at all still work exactly as before (custom/service sales) ===");
  const customSale = await (await salesMod.onRequestPost({ request: req({ description: "Custom tailoring, no catalog link", sale_price: 1500 }), env })).json();
  assert(customSale.id, "a sale with no product_id still succeeds — this path is deliberately optional, not mandatory");

  section("=== Entering existing stock with no RM/WO linkage: cost roll-up must not lie about it ===");
  const productDetailMod = await import("../functions/api/products/[id].js");
  const costMod = await import("../functions/api/products/[id]/cost.js");
  const materialsMod = await import("../functions/api/materials.js");
  const batchesMod = await import("../functions/api/batches.js");
  const workordersMod = await import("../functions/api/workorders.js");
  const issueMod = await import("../functions/api/workorders/[id]/issue-material.js");
  const receiveMod = await import("../functions/api/workorders/[id]/receive.js");
  const mat = await (await materialsMod.onRequestPost({ request: req({ name: "Test Material" }), env })).json();
  const batch = await (await batchesMod.onRequestPost({ request: req({ material_id: mat.id, metres_received: 10, purchase_amount: 1000 }), env })).json();

  const legacyProd = await (await productsMod.onRequestPost({ request: req({ name: "Legacy Stock Saree", price: 800, cost: 400, stock_qty: 10 }), env })).json();
  const legacyCost = await (await costMod.onRequestGet({ params: { id: legacyProd.id }, env })).json();
  assert(legacyCost.cost_source === "manual", "a product with no work-order history correctly reports its cost as 'manual', not fabricated");
  assert(legacyCost.cost_per_unit === 400, `the manually-entered cost (400) is used, not silently reported as 0 (got ${legacyCost.cost_per_unit})`);
  assert(legacyCost.margin_per_unit === 400, `margin correctly computed as 800 - 400 = 400, not the misleading 800 that a cost-of-zero would imply (got ${legacyCost.margin_per_unit})`);

  const noCostProd = await (await productsMod.onRequestPost({ request: req({ name: "No Cost Given", price: 500, stock_qty: 5 }), env })).json();
  const noCostResult = await (await costMod.onRequestGet({ params: { id: noCostProd.id }, env })).json();
  assert(noCostResult.cost_source === "none" && noCostResult.cost_per_unit === null && noCostResult.margin_per_unit === null,
    "a product with neither a work-order trail NOR a manually entered cost honestly reports 'none' rather than guessing");

  const traceableProd = await (await productsMod.onRequestPost({ request: req({ name: "Traced Item", stock_qty: 0 }), env })).json();
  const wo = await (await workordersMod.onRequestPost({ request: req({ description: "d" }), env })).json();
  await issueMod.onRequestPost({ request: req({ material_batch_id: batch.id, metres: 1, worker_name: "X" }), env, params: { id: wo.id }, data: { user: {} } });
  await receiveMod.onRequestPost({ request: req({ product_id: traceableProd.id, quantity: 1 }), env, params: { id: wo.id }, data: { user: {} } });
  const traceableCost = await (await costMod.onRequestGet({ params: { id: traceableProd.id }, env })).json();
  assert(traceableCost.cost_source === "work_orders", "once a work order actually feeds a product, cost_source correctly switches to 'work_orders'");

  section("=== Adjusting stock directly (topping up existing inventory later, or correcting a count) ===");
  const adjustMod = await import("../functions/api/products/[id]/adjust-stock.js");
  const addStock = await (await adjustMod.onRequestPost({ request: req({ delta: 5, reason: "Found 5 more from old inventory count" }), env, params: { id: legacyProd.id }, data: { user: { name: "tester" } } })).json();
  assert(addStock.ok && addStock.new_stock_qty === 15, `adding 5 to existing 10 gives 15 (got ${addStock.new_stock_qty})`);

  const removeStock = await (await adjustMod.onRequestPost({ request: req({ delta: -3, reason: "Damaged, written off" }), env, params: { id: legacyProd.id }, data: { user: {} } })).json();
  assert(removeStock.ok && removeStock.new_stock_qty === 12, `removing 3 from 15 gives 12 (got ${removeStock.new_stock_qty})`);

  const overRemove = await (await adjustMod.onRequestPost({ request: req({ delta: -999 }), env, params: { id: legacyProd.id } })).json();
  assert(overRemove.error, "adjusting stock below zero is rejected, not allowed to go negative");

  const adjustLog = await env.DB.prepare("SELECT * FROM inventory_log WHERE item_ref = ? AND event = 'adjusted'").bind(legacyProd.id).all();
  assert(adjustLog.results.length === 2, "both stock adjustments (the +5 and the -3) are permanently logged for traceability");

  const missingProdAdjust = await (await adjustMod.onRequestPost({ request: req({ delta: 1 }), env, params: { id: "PRD-999999" } })).json();
  assert(missingProdAdjust.error, "adjusting a nonexistent product 404s cleanly");

  section("=== Summary ===");
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS CRASHED:", e); process.exit(1); });
