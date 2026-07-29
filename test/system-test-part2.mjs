// Second pass: covers every endpoint not exercised by system-test.mjs, plus
// additional edge cases. Run with: node test/system-test-part2.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { wrapD1, makeFakeR2, fakePhotoFormData } from "./d1-shim.mjs";

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
  section("=== Seed some baseline data to list against ===");
  const materialsMod = await import("../functions/api/materials.js");
  const suppliersMod = await import("../functions/api/suppliers.js");
  const workersMod = await import("../functions/api/workers.js");
  const batchesMod = await import("../functions/api/batches.js");
  const workordersMod = await import("../functions/api/workorders.js");

  const mat = await (await materialsMod.onRequestPost({ request: req({ name: "Silk", color: "Red" }), env })).json();
  const sup = await (await suppliersMod.onRequestPost({ request: req({ name: "ABC Textiles" }), env })).json();
  const wkr = await (await workersMod.onRequestPost({ request: req({ name: "Mortaja" }), env })).json();
  const batch = await (await batchesMod.onRequestPost({ request: req({ material_id: mat.id, supplier_id: sup.id, metres_received: 30, purchase_amount: 9000 }), env })).json();
  const wo = await (await workordersMod.onRequestPost({ request: req({ description: "Red silk saree" }), env })).json();

  section("=== GET list endpoints all return arrays without error ===");
  assert(Array.isArray(await (await materialsMod.onRequestGet({ env })).json()), "GET /materials returns an array");
  assert(Array.isArray(await (await suppliersMod.onRequestGet({ env })).json()), "GET /suppliers returns an array");
  assert(Array.isArray(await (await workersMod.onRequestGet({ env })).json()), "GET /workers returns an array");
  assert(Array.isArray(await (await batchesMod.onRequestGet({ env })).json()), "GET /batches returns an array");
  assert(Array.isArray(await (await workordersMod.onRequestGet({ env })).json()), "GET /workorders returns an array");

  const batchDetailMod = await import("../functions/api/batches/[id].js");
  const batchDetail = await (await batchDetailMod.onRequestGet({ params: { id: batch.id }, env })).json();
  assert(batchDetail.id === batch.id && Array.isArray(batchDetail.photos), "GET single batch detail includes photos array");

  const batchDetail404 = await (await batchDetailMod.onRequestGet({ params: { id: "RM-999999" }, env })).json();
  assert(batchDetail404.error, "GET single batch detail 404s on a nonexistent batch");

  section("=== Sales / Purchases / Expenses / Dispatch / Ledger / P&L ===");
  const salesMod = await import("../functions/api/sales.js");
  const salesCreate = await (await salesMod.onRequestPost({ request: req({ description: "Test sale", sale_price: 1500, customer_name: "Walk-in" }), env })).json();
  assert(salesCreate.id === "SALE-000001", "created a sale");
  const salesList = await (await salesMod.onRequestGet({ env })).json();
  assert(salesList.length === 1, "GET /sales lists the sale just created");

  const purchasesMod = await import("../functions/api/purchases.js");
  const purchaseCreate = await (await purchasesMod.onRequestPost({ request: req({ supplier_name: "ABC Textiles", amount: 2000 }), env })).json();
  assert(purchaseCreate.id === "PUR-000001", "created a purchase");
  assert((await (await purchasesMod.onRequestGet({ env })).json()).length === 1, "GET /purchases lists it");

  const expensesMod = await import("../functions/api/expenses.js");
  const expenseCreate = await (await expensesMod.onRequestPost({ request: req({ description: "Electricity", amount: 500 }), env })).json();
  assert(expenseCreate.id === "EXP-000001", "created an expense");
  assert((await (await expensesMod.onRequestGet({ env })).json()).length === 1, "GET /expenses lists it");

  const dispatchMod = await import("../functions/api/dispatch.js");
  const dispatchRes = await (await dispatchMod.onRequestPost({ request: req({ work_order_id: wo.id, courier: "DTDC", tracking_id: "TRK123" }), env, data: { user: { name: "tester" } } })).json();
  assert(dispatchRes.ok, "dispatched a work order");
  const dispatchList = await (await dispatchMod.onRequestGet({ env })).json();
  assert(dispatchList.length === 1 && dispatchList[0].tracking_id === "TRK123", "GET /dispatch shows the dispatched order with tracking id");

  const dispatchBadWo = await (await dispatchMod.onRequestPost({ request: req({ work_order_id: "WO-999999", courier: "X" }), env, data: { user: {} } })).json();
  assert(dispatchBadWo.error, "dispatch rejects a nonexistent work order");

  const ledgerMod = await import("../functions/api/ledger.js");
  const ledgerList = await (await ledgerMod.onRequestGet({ request: { url: "https://x.pages.dev/api/ledger" }, env })).json();
  assert(ledgerList.length === 3 && ["sale","purchase","expense"].every((t) => ledgerList.some((l) => l.type === t)),
    "ledger has exactly 3 entries: the sale, purchase, and expense each auto-posted");

  const pnlMod = await import("../functions/api/reports/pnl.js");
  const pnl = await (await pnlMod.onRequestGet({ request: { url: "https://x.pages.dev/api/reports/pnl" }, env })).json();
  assert(pnl.sales.total === 1500 && pnl.purchases.total === 2000 && pnl.expenses.total === 500, "P&L totals match sales/purchases/expenses exactly");
  assert(pnl.profit === 1500 - 2000 - 500, "P&L profit calculation is correct (should be -1000)");

  section("=== Dashboard doesn't crash and returns sane shape ===");
  const dashboardMod = await import("../functions/api/reports/dashboard.js");
  const dash = await (await dashboardMod.onRequestGet({ env })).json();
  assert(Array.isArray(dash.pendingByStage) && Array.isArray(dash.wipByWorker) && Array.isArray(dash.lowStock)
    && Array.isArray(dash.overdueDispatch) && Array.isArray(dash.urgentOpenOrders) && dash.outstandingSummary,
    "dashboard returns all expected sections without error");

  section("=== Reseller portal only sees their own data ===");
  const resellerOrdersMod = await import("../functions/api/reseller/orders.js");
  await workordersMod.onRequestPost({ request: req({ description: "Reseller order", reseller_name: "SHIMI" }), env });
  await salesMod.onRequestPost({ request: req({ description: "Reseller sale", sale_price: 2000, reseller_name: "SHIMI" }), env });
  const shimiView = await (await resellerOrdersMod.onRequestGet({ env, data: { user: { resellerName: "SHIMI" } } })).json();
  assert(shimiView.orders.length === 1 && shimiView.sales.length === 1, "reseller endpoint returns only SHIMI's own order and sale");

  const noLinkView = await (await resellerOrdersMod.onRequestGet({ env, data: { user: {} } })).json();
  assert(noLinkView.error, "reseller endpoint errors clearly if the login has no reseller_name linked");

  section("=== Scan: unrecognized code format ===");
  const scanMod = await import("../functions/api/scan/[code].js");
  const badFormat = await (await scanMod.onRequestGet({ params: { code: "XYZ-000001" }, env })).json();
  assert(badFormat.error, "scanning a code that's neither RM- nor WO- returns a clear error, not a crash");

  section("=== Stage: invalid stage name rejected ===");
  const stageMod = await import("../functions/api/workorders/[id]/stage.js");
  const badStage = await (await stageMod.onRequestPost({ request: req({ stage: "Not A Real Stage" }), env, params: { id: wo.id } })).json();
  assert(badStage.error, "advancing to a made-up stage name is rejected");

  section("=== Photo upload + retrieval round-trip (work order + product) ===");
  const woPhotoMod = await import("../functions/api/workorders/[id]/photo.js");
  await woPhotoMod.onRequestPost({ request: { formData: async () => fakePhotoFormData() }, env, params: { id: wo.id } });
  const photoServeMod = await import("../functions/api/photo/[[path]].js");
  const woDetailMod = await import("../functions/api/workorders/[id].js");
  const woWithPhoto = await (await woDetailMod.onRequestGet({ params: { id: wo.id }, env })).json();
  assert(woWithPhoto.photos.length === 1, "work order photo upload shows up when fetching the order");
  const servedPhoto = await photoServeMod.onRequestGet({ params: { path: woWithPhoto.photos[0].r2_key.split("/") }, env });
  assert(servedPhoto.status !== 404, "the uploaded photo can actually be retrieved back through the photo-serving route");

  const missingPhoto = await photoServeMod.onRequestGet({ params: { path: ["nonexistent", "key.jpg"] }, env });
  assert(missingPhoto.status === 404, "requesting a photo key that was never uploaded correctly 404s");

  section("=== Product detail + stock/price PATCH ===");
  const productsMod = await import("../functions/api/products.js");
  const productDetailMod = await import("../functions/api/products/[id].js");
  const prod = await (await productsMod.onRequestPost({ request: req({ name: "Test Item", price: 1000, stock_qty: 5 }), env })).json();
  await productDetailMod.onRequestPatch({ request: req({ price: 1200, stock_qty: 8 }), env, params: { id: prod.id } });
  const prodAfterPatch = await (await productDetailMod.onRequestGet({ params: { id: prod.id }, env })).json();
  assert(prodAfterPatch.price === 1200 && prodAfterPatch.stock_qty === 8, "PATCHing a product's price/stock actually persists");

  const patchNothing = await (await productDetailMod.onRequestPatch({ request: req({}), env, params: { id: prod.id } })).json();
  assert(patchNothing.error, "PATCHing a product with no fields at all is rejected instead of silently doing nothing");

  section("=== User actions: activate + reset_pin + unknown action + missing user ===");
  const usersMod = await import("../functions/api/users.js");
  const userActionMod = await import("../functions/api/users/[id].js");
  const u = await (await usersMod.onRequestPost({ request: req({ name: "Test Worker 2", username: "tw2", pin: "startpin123", role: "worker" }), env })).json();

  await userActionMod.onRequestPatch({ request: req({ action: "deactivate" }), env, params: { id: String(u.id) } });
  const reactivate = await (await userActionMod.onRequestPatch({ request: req({ action: "activate" }), env, params: { id: String(u.id) } })).json();
  assert(reactivate.ok, "reactivating a disabled user succeeds");

  const resetPin = await (await userActionMod.onRequestPatch({ request: req({ action: "reset_pin", new_pin: "brandnewpin123" }), env, params: { id: String(u.id) } })).json();
  assert(resetPin.ok, "resetting a user's PIN succeeds");

  const loginMod = await import("../functions/api/auth/login.js");
  const loginWithNewPin = await (await loginMod.onRequestPost({ request: req({ username: "tw2", pin: "brandnewpin123" }), env })).json();
  assert(loginWithNewPin.token, "can actually log in with the newly reset PIN");

  const loginWithOldPin = await (await loginMod.onRequestPost({ request: req({ username: "tw2", pin: "startpin123" }), env })).json();
  assert(loginWithOldPin.error, "the OLD PIN no longer works after a reset");

  const unknownAction = await (await userActionMod.onRequestPatch({ request: req({ action: "self_destruct" }), env, params: { id: String(u.id) } })).json();
  assert(unknownAction.error, "an unrecognized user action is rejected rather than silently ignored");

  const missingUser = await (await userActionMod.onRequestPatch({ request: req({ action: "revoke_sessions" }), env, params: { id: "999999" } })).json();
  assert(missingUser.error, "acting on a user id that doesn't exist returns an error, not a silent no-op");

  section("=== Party master edge cases ===");
  const partiesMod = await import("../functions/api/parties.js");
  const noNameParty = await (await partiesMod.onRequestPost({ request: req({ type: "customer" }), env })).json();
  assert(noNameParty.error, "creating a party with no name is rejected");

  section("=== Summary ===");
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS CRASHED:", e); process.exit(1); });
