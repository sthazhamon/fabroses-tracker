export async function onRequestGet({ params, env }) {
  const order = await env.DB.prepare(
    `SELECT co.*, p.name AS product_name, p.item_code, p.price AS product_price
     FROM customer_orders co
     LEFT JOIN products p ON p.id = co.product_id
     WHERE co.id = ?`
  ).bind(params.id).first();

  if (!order) return Response.json({ error: "not found" }, { status: 404 });

  let workOrder = null;
  if (order.linked_work_order_id) {
    workOrder = await env.DB.prepare(
      `SELECT w.*, wk.name AS worker_name FROM work_orders w
       LEFT JOIN workers wk ON wk.id = w.worker_id WHERE w.id = ?`
    ).bind(order.linked_work_order_id).first();
    if (workOrder) {
      const { results: stages } = await env.DB.prepare(
        "SELECT * FROM stage_log WHERE work_order_id = ? ORDER BY changed_at ASC"
      ).bind(order.linked_work_order_id).all();
      const { results: issues } = await env.DB.prepare(
        "SELECT * FROM material_issues WHERE work_order_id = ? ORDER BY issued_at ASC"
      ).bind(order.linked_work_order_id).all();
      workOrder = { ...workOrder, stages, issues };
    }
  }

  let sale = null;
  if (order.sale_id) {
    sale = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(order.sale_id).first();
  }

  return Response.json({ ...order, work_order: workOrder, sale });
}

export async function onRequestPatch({ request, env, params }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM customer_orders WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Customer order not found" }, { status: 404 });

  if (body.status === "cancelled") {
    if (["billed", "shipped"].includes(existing.status)) {
      return Response.json({ error: `Can't cancel — this order is already ${existing.status}` }, { status: 400 });
    }
    await env.DB.prepare("UPDATE customer_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(params.id).run();
    return Response.json({ ok: true });
  }

  const editable = ["customer_name", "customer_phone", "promised_delivery_date", "notes"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE customer_orders SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).bind(...Object.values(changes), params.id).run();
  return Response.json({ ok: true });
}
