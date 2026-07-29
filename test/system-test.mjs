// Runs the ACTUAL functions/api/*.js handler code — the same files that get
// deployed — against a real in-memory SQLite database and a fake R2 bucket.
// No reimplementation of business logic here; if this passes, the real
// endpoints behave this way too, modulo the D1/R2 platform bindings
// themselves (which are the only thing faked).
//
// Run with: node test/system-test.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { wrapD1, makeFakeR2, fakePhotoFormData } from "./d1-shim.mjs";

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failed++; console.log(`  \x1b[31m✗ FAIL\x1b[0m ${label}`); }
}
function section(title) { console.log(`\n${title}`); }

// ---------------- set up a fresh database with the full migration chain ----------------
const sqliteDb = new DatabaseSync(":memory:");
for (const f of ["schema.sql", "schema_v2.sql", "schema_v3.sql", "schema_v4.sql", "schema_v5.sql", "schema_v6.sql"]) {
  sqliteDb.exec(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
}
const env = { DB: wrapD1(sqliteDb), PHOTOS: makeFakeR2(), AUTH_SECRET: "test-secret" };

function req(body) {
  return { json: async () => body };
}

async function run() {
  section("=== Party master ===");
  const partiesMod = await import("../functions/api/parties.js");

  const supplierRes = await (await partiesMod.onRequestPost({ request: req({ name: "Neelam Fabrics", type: "supplier", opening_balance: 5000 }), env })).json();
  assert(supplierRes.id === "PTY-000001", "created first party with id PTY-000001");

  const dupRes = await (await partiesMod.onRequestPost({ request: req({ name: "Neelam Fabrics", type: "supplier" }), env })).json();
  assert(dupRes.error, "rejects a duplicate party name");

  const badTypeRes = await (await partiesMod.onRequestPost({ request: req({ name: "Someone", type: "bogus" }), env })).json();
  assert(badTypeRes.error, "rejects an invalid party type");

  section("=== Materials master + raw material batch intake ===");
  const materialsMod = await import("../functions/api/materials.js");
  const matRes = await (await materialsMod.onRequestPost({ request: req({ name: "Kota Organza", color: "Turquoise" }), env })).json();
  assert(matRes.id === 1, "created material master entry");

  const suppliersMod = await import("../functions/api/suppliers.js");
  const supMasterRes = await (await suppliersMod.onRequestPost({ request: req({ name: "Neelam Fabrics" }), env })).json();

  const batchesMod = await import("../functions/api/batches.js");
  const batchRes = await (await batchesMod.onRequestPost({
    request: req({ material_id: matRes.id, supplier_id: supMasterRes.id, metres_received: 50, purchase_amount: 12000 }), env,
  })).json();
  assert(batchRes.id === "RM-000001", "created raw material batch RM-000001");

  const invLogAfterIntake = await env.DB.prepare("SELECT * FROM inventory_log WHERE item_ref = ?").bind(batchRes.id).all();
  assert(invLogAfterIntake.results.length === 1 && invLogAfterIntake.results[0].event === "received_into_store",
    "logged a received_into_store traceability event on intake");

  section("=== Worker + work order creation ===");
  const workersMod = await import("../functions/api/workers.js");
  const workerRes = await (await workersMod.onRequestPost({ request: req({ name: "Zakir" }), env })).json();

  const workordersMod = await import("../functions/api/workorders.js");
  const woRes = await (await workordersMod.onRequestPost({
    request: req({ description: "Blue kota organza border saree, embroidery work", worker_id: workerRes.id, priority: "urgent", due_date: "2026-08-15" }), env,
  })).json();
  assert(woRes.id === "WO-000001", "created work order WO-000001");

  section("=== Issue raw material to worker (job-work out) ===");
  const issueMod = await import("../functions/api/workorders/[id]/issue-material.js");

  const overIssue = await (await issueMod.onRequestPost({
    request: req({ material_batch_id: batchRes.id, metres: 999, worker_name: "Zakir" }), env, params: { id: woRes.id }, data: { user: { name: "tester" } },
  })).json();
  assert(overIssue.error, "rejects issuing more metres than the batch has available");

  const issueRes = await (await issueMod.onRequestPost({
    request: req({ material_batch_id: batchRes.id, metres: 12, worker_name: "Zakir" }), env, params: { id: woRes.id }, data: { user: { name: "tester" } },
  })).json();
  assert(issueRes.id === "ISS-000001", "issued material, created ISS-000001");

  const batchAfterIssue = await env.DB.prepare("SELECT * FROM material_batches WHERE id = ?").bind(batchRes.id).first();
  assert(batchAfterIssue.metres_balance === 38, "store balance correctly reduced 50m -> 38m after issuing 12m");

  const issueRow = await env.DB.prepare("SELECT * FROM material_issues WHERE id = ?").bind(issueRes.id).first();
  assert(issueRow.status === "with_worker", "issue record correctly shows status = with_worker");

  section("=== Inventory status by location (Store vs Worker) ===");
  const invStatusMod = await import("../functions/api/inventory-status.js");
  const invStatus = await (await invStatusMod.onRequestGet({ env })).json();
  assert(invStatus.storeRaw.find((b) => b.id === batchRes.id)?.metres_balance === 38, "store view shows 38m remaining for this batch");
  assert(invStatus.withWorkers.length === 1 && invStatus.withWorkers[0].worker_name === "Zakir" && invStatus.withWorkers[0].metres_issued === 12,
    "worker view shows Zakir currently holding 12m for this work order");

  section("=== Advance stage while work is in progress ===");
  const stageMod = await import("../functions/api/workorders/[id]/stage.js");
  const stageRes = await (await stageMod.onRequestPost({ request: req({ stage: "Handwork", changed_by: "tester" }), env, params: { id: woRes.id } })).json();
  assert(stageRes.stage === "Handwork", "stage advanced to Handwork");

  section("=== Receive finished good back (job-work in) ===");
  const receiveMod = await import("../functions/api/workorders/[id]/receive.js");

  const badReceive = await (await receiveMod.onRequestPost({ request: req({ quantity: 1 }), env, params: { id: woRes.id }, data: { user: { name: "tester" } } })).json();
  assert(badReceive.error, "rejects receiving with neither product_id nor new_product_name");

  const receiveRes = await (await receiveMod.onRequestPost({
    request: req({ new_product_name: "Blue Kota Organza Saree - Finished", quantity: 1, notes: "Came back clean" }),
    env, params: { id: woRes.id }, data: { user: { name: "tester" } },
  })).json();
  assert(receiveRes.ok && receiveRes.product_id === "PRD-000001", "received finished good, auto-created PRD-000001");

  const productAfterReceive = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(receiveRes.product_id).first();
  assert(productAfterReceive.stock_qty === 1, "finished goods stock incremented to 1 unit");

  const issueAfterReceive = await env.DB.prepare("SELECT * FROM material_issues WHERE id = ?").bind(issueRes.id).first();
  assert(issueAfterReceive.status === "received", "the open material issue was closed out (status = received) on receipt");

  const woAfterReceive = await env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(woRes.id).first();
  assert(woAfterReceive.received_qty === 1 && woAfterReceive.received_at, "work order shows received_qty and received_at populated");

  section("=== Inventory status reflects the completed job-work cycle ===");
  const invStatusAfter = await (await invStatusMod.onRequestGet({ env })).json();
  assert(invStatusAfter.withWorkers.length === 0, "Zakir no longer shows any open material issue");
  assert(invStatusAfter.finishedStock.find((p) => p.id === "PRD-000001")?.stock_qty === 1, "finished stock view shows the new product with qty 1");

  section("=== Full traceability chain, queried from the work order itself ===");
  const woDetailMod = await import("../functions/api/workorders/[id].js");
  const woDetail = await (await woDetailMod.onRequestGet({ params: { id: woRes.id }, env })).json();
  assert(woDetail.issues.length === 1 && woDetail.issues[0].status === "received", "work order detail includes its material issue history");
  assert(woDetail.trace.some((t) => t.event === "issued_to_worker") && woDetail.trace.some((t) => t.event === "returned_finished_good"),
    "work order detail's trace log shows both the issue-out and return-in events, in order");
  assert(woDetail.trace[0].event === "issued_to_worker" && woDetail.trace[1].event === "returned_finished_good",
    "trace events are correctly ordered chronologically (issued before returned)");

  section("=== Scan endpoint surfaces the same traceability (what a worker actually sees) ===");
  const scanMod = await import("../functions/api/scan/[code].js");
  const scanResult = await (await scanMod.onRequestGet({ params: { code: woRes.id }, env })).json();
  assert(scanResult.type === "work_order" && scanResult.issues.length === 1 && scanResult.trace.length === 2,
    "scanning the work order QR returns full issue + trace history");

  const scanBatch = await (await scanMod.onRequestGet({ params: { code: batchRes.id }, env })).json();
  assert(scanBatch.type === "batch" && scanBatch.issues.length === 1, "scanning the raw material batch QR shows it was issued out once");

  section("=== Party ledger: sales, payments, and opening balance all combine correctly ===");
  const salesMod = await import("../functions/api/sales.js");
  const custPartyRes = await (await partiesMod.onRequestPost({ request: req({ name: "Priya Nair", type: "customer", opening_balance: 500 }), env })).json();

  await salesMod.onRequestPost({
    request: req({ description: "Saree sale", customer_name: "Priya Nair", sale_price: 3000, amount_received: 1000, sale_date: "2026-07-01" }), env,
  });

  const paymentsMod = await import("../functions/api/payments.js");
  await paymentsMod.onRequestPost({
    request: req({ party_name: "Priya Nair", direction: "in", amount: 800, payment_date: "2026-07-15" }), env,
  });

  const partiesAfter = await (await partiesMod.onRequestGet({ env })).json();
  const priya = partiesAfter.find((p) => p.name === "Priya Nair");
  // opening 500 + billed 3000 - received_at_sale 1000 - later payment 800 = 1700 still owed
  assert(priya && priya.balance === 1700, `Priya's outstanding balance correctly computed as 1700 (got ${priya?.balance})`);

  const neelam = partiesAfter.find((p) => p.name === "Neelam Fabrics");
  assert(neelam && neelam.balance === 5000, "supplier with only an opening balance and no purchases yet shows balance = opening balance");

  section("=== Auth: login lockout after repeated failures ===");
  const usersMod = await import("../functions/api/users.js");
  await usersMod.onRequestPost({ request: req({ name: "Admin Test", username: "admintest", pin: "correctpin123", role: "admin" }), env });

  const loginMod = await import("../functions/api/auth/login.js");
  let lastLoginResult;
  for (let i = 0; i < 5; i++) {
    lastLoginResult = await (await loginMod.onRequestPost({ request: req({ username: "admintest", pin: "wrongpin" }), env })).json();
  }
  assert(lastLoginResult.error && lastLoginResult.error.includes("Locked"), "account locks out after 5 failed PIN attempts");

  const stillLocked = await (await loginMod.onRequestPost({ request: req({ username: "admintest", pin: "correctpin123" }), env })).json();
  assert(stillLocked.error && stillLocked.error.includes("Too many"), "correct PIN is still rejected while lockout is active");

  section("=== Edge cases: 404s on bad references ===");
  const badWoIssue = await (await issueMod.onRequestPost({
    request: req({ material_batch_id: batchRes.id, metres: 1, worker_name: "Zakir" }), env, params: { id: "WO-999999" }, data: { user: { name: "tester" } },
  })).json();
  assert(badWoIssue.error, "issue-material 404s on a work order that doesn't exist");

  const badBatchIssue = await (await issueMod.onRequestPost({
    request: req({ material_batch_id: "RM-999999", metres: 1, worker_name: "Zakir" }), env, params: { id: woRes.id }, data: { user: { name: "tester" } },
  })).json();
  assert(badBatchIssue.error, "issue-material 404s on a material batch that doesn't exist");

  const badWoReceive = await (await receiveMod.onRequestPost({
    request: req({ new_product_name: "X", quantity: 1 }), env, params: { id: "WO-999999" }, data: { user: { name: "tester" } },
  })).json();
  assert(badWoReceive.error, "receive 404s on a work order that doesn't exist");

  const badProductReceive = await (await receiveMod.onRequestPost({
    request: req({ product_id: "PRD-999999", quantity: 1 }), env, params: { id: woRes.id }, data: { user: { name: "tester" } },
  })).json();
  assert(badProductReceive.error, "receive rejects a product_id that doesn't exist in the catalog");

  section("=== Second job-work cycle: receiving against EXISTING catalog stock (not auto-created) ===");
  const batch2Res = await (await batchesMod.onRequestPost({ request: req({ material_id: matRes.id, metres_received: 20 }), env })).json();
  const wo2Res = await (await workordersMod.onRequestPost({ request: req({ description: "Second matching piece" }), env })).json();
  await issueMod.onRequestPost({
    request: req({ material_batch_id: batch2Res.id, metres: 5, worker_name: "Zakir" }), env, params: { id: wo2Res.id }, data: { user: { name: "tester" } },
  });
  const receive2Res = await (await receiveMod.onRequestPost({
    request: req({ product_id: "PRD-000001", quantity: 1 }), env, params: { id: wo2Res.id }, data: { user: { name: "tester" } },
  })).json();
  const productAfterSecond = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind("PRD-000001").first();
  assert(receive2Res.ok && productAfterSecond.stock_qty === 2, `receiving against an existing catalog item adds to its stock rather than duplicating it (stock now ${productAfterSecond.stock_qty}, expected 2)`);

  section("=== Product catalog: create, photo upload, cover photo shows in listing ===");
  const productsMod = await import("../functions/api/products.js");
  const productPhotoMod = await import("../functions/api/products/[id]/photo.js");
  const newProdRes = await (await productsMod.onRequestPost({
    request: req({ name: "Test Blouse", category: "Blouse", price: 800, stock_qty: 3 }), env,
  })).json();
  await productPhotoMod.onRequestPost({ request: { formData: async () => fakePhotoFormData() }, env, params: { id: newProdRes.id } });
  const catalogList = await (await productsMod.onRequestGet({ env })).json();
  const listedProduct = catalogList.find((p) => p.id === newProdRes.id);
  assert(listedProduct && listedProduct.cover_photo, "newly uploaded photo shows up as the product's cover photo in the catalog listing");

  section("=== Permission middleware: real enforcement, not just documentation ===");
  const middlewareMod = await import("../functions/api/_middleware.js");
  const { signToken } = await import("../functions/api/_auth.js");

  const workerUserRes = await (await usersMod.onRequestPost({ request: req({ name: "Floor Worker", username: "flooruser", pin: "workerpin123", role: "worker" }), env })).json();
  const workerToken = await signToken({ id: workerUserRes.id, name: "Floor Worker", role: "worker", tokenVersion: 1, exp: Date.now() + 100000 }, "test-secret");

  const realAdminRes = await (await usersMod.onRequestPost({ request: req({ name: "Real Admin", username: "realadmin2", pin: "adminpin123", role: "admin" }), env })).json();
  const adminToken = await signToken({ id: realAdminRes.id, name: "Real Admin", role: "admin", tokenVersion: 1, exp: Date.now() + 100000 }, "test-secret");

  function fakeContextFor(path, token) {
    return {
      request: { url: `https://example.pages.dev${path}`, headers: { get: (h) => (h === "Authorization" ? `Bearer ${token}` : null) } },
      env, data: {}, next: async () => Response.json({ passedThrough: true }),
    };
  }

  const workerBlockedRes = await (await middlewareMod.onRequest(fakeContextFor("/api/parties", workerToken))).json();
  assert(workerBlockedRes.error && workerBlockedRes.error.includes("access"), "middleware correctly BLOCKS a worker-role login from /api/parties");

  const adminAllowedRes = await (await middlewareMod.onRequest(fakeContextFor("/api/parties", adminToken))).json();
  assert(adminAllowedRes.passedThrough === true, "middleware correctly ALLOWS an admin-role login through to /api/parties");

  const noTokenRes = await (await middlewareMod.onRequest(fakeContextFor("/api/parties", ""))).json();
  assert(noTokenRes.error && noTokenRes.error.includes("sign in"), "middleware blocks requests with no auth token at all");

  const publicRouteRes = await (await middlewareMod.onRequest(fakeContextFor("/api/auth/login", ""))).json();
  assert(publicRouteRes.passedThrough === true, "middleware allows the public /api/auth/login route through with no token");

  const ghostToken = await signToken({ id: 99999, name: "Ghost", role: "admin", tokenVersion: 1, exp: Date.now() + 100000 }, "test-secret");
  const ghostRes = await (await middlewareMod.onRequest(fakeContextFor("/api/parties", ghostToken))).json();
  assert(ghostRes.error, "a token for a user id that doesn't exist in the database is rejected, not trusted at face value");

  section("=== Live session revocation actually works, not just in theory ===");
  const userActionMod = await import("../functions/api/users/[id].js");
  const workerTokenBeforeRevoke = await (await middlewareMod.onRequest(fakeContextFor("/api/inventory-status", workerToken))).json();
  assert(workerTokenBeforeRevoke.passedThrough === true, "sanity check: worker's token works on an allowed route before revocation");

  await userActionMod.onRequestPatch({ request: req({ action: "revoke_sessions" }), env, params: { id: String(workerUserRes.id) } });
  const workerTokenAfterRevoke = await (await middlewareMod.onRequest(fakeContextFor("/api/inventory-status", workerToken))).json();
  assert(workerTokenAfterRevoke.error && workerTokenAfterRevoke.error.includes("signed out"),
    "the SAME token that worked a moment ago is rejected immediately after an admin revokes that user's sessions");

  await userActionMod.onRequestPatch({ request: req({ action: "deactivate" }), env, params: { id: String(realAdminRes.id) } });
  const deactivatedAdminRes = await (await middlewareMod.onRequest(fakeContextFor("/api/parties", adminToken))).json();
  assert(deactivatedAdminRes.error && deactivatedAdminRes.error.includes("disabled"),
    "a disabled login's existing token stops working immediately, not just future logins");

  section("=== Summary ===");
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("TEST HARNESS CRASHED:", e); process.exit(1); });
