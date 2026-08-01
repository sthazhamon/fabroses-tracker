export async function onRequestPost({ request, env, params, data }) {
  const body = await request.json();
  const { product_id, new_product_name, quantity, notes, description, price, cost, category, labor_cost } = body;

  if (!quantity) return Response.json({ error: "quantity is required" }, { status: 400 });

  const order = await env.DB.prepare(
    `SELECT w.*, wk.name AS worker_name FROM work_orders w
     LEFT JOIN workers wk ON wk.id = w.worker_id WHERE w.id = ?`
  ).bind(params.id).first();
  if (!order) return Response.json({ error: "Work order not found" }, { status: 404 });

  let finalProductId = product_id || null;

  if (finalProductId) {
    const exists = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(finalProductId).first();
    if (!exists) return Response.json({ error: "That product code doesn't exist in the catalog" }, { status: 404 });
  } else if (new_product_name) {
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM products").first();
    finalProductId = "PRD-" + String((countRow?.c || 0) + 1).padStart(6, "0");
    await env.DB.prepare(
      `INSERT INTO products (id, name, category, price, cost, stock_qty, description)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      finalProductId, new_product_name, category || null, price || null, cost || null,
      description || `Made from ${params.id}`
    ).run();
  } else {
    return Response.json({ error: "Provide either product_id (existing catalog item) or new_product_name" }, { status: 400 });
  }

  await env.DB.prepare(
    "UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?"
  ).bind(quantity, finalProductId).run();

  // Close out whatever raw material was issued against this work order and never formally returned.
  await env.DB.prepare(
    "UPDATE material_issues SET status = 'received', received_at = datetime('now') WHERE work_order_id = ? AND status = 'with_worker'"
  ).bind(params.id).run();

  await env.DB.prepare(
    "UPDATE work_orders SET received_qty = ?, received_at = datetime('now'), output_product_id = ?, labor_cost = ? WHERE id = ?"
  ).bind(quantity, finalProductId, labor_cost || null, params.id).run();

  await env.DB.prepare(
    `INSERT INTO inventory_log (item_type, item_ref, work_order_id, event, quantity, from_location, to_location, notes, created_by)
     VALUES ('finished_good', ?, ?, ?, ?, ?, 'Store', ?, ?)`
  ).bind(finalProductId, params.id, "returned_finished_good", quantity, order.worker_name || "worker", notes || null, data.user?.name || "system").run();

  // Close the loop for any customer order that was waiting on exactly this
  // work order — the stock just landed, so it's ready to bill and ship.
  await env.DB.prepare(
    "UPDATE customer_orders SET status = 'ready_to_bill', updated_at = datetime('now') WHERE linked_work_order_id = ? AND status IN ('awaiting_material', 'awaiting_wip')"
  ).bind(params.id).run();

  return Response.json({ ok: true, product_id: finalProductId });
}
