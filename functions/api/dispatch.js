export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, description, customer_name, reseller_name, courier, tracking_id, dispatch_date, stage
     FROM work_orders
     WHERE stage IN ('Dispatched', 'Delivered')
     ORDER BY dispatch_date DESC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env, data }) {
  const body = await request.json();
  const { work_order_id, courier, tracking_id, dispatch_date } = body;

  if (!work_order_id) {
    return Response.json({ error: "work_order_id is required" }, { status: 400 });
  }

  const order = await env.DB.prepare("SELECT id FROM work_orders WHERE id = ?").bind(work_order_id).first();
  if (!order) return Response.json({ error: "Work order not found" }, { status: 404 });

  const effectiveDate = dispatch_date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `UPDATE work_orders
     SET stage = 'Dispatched', dispatch_date = ?, tracking_id = ?, courier = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(effectiveDate, tracking_id || null, courier || null, work_order_id).run();

  await env.DB.prepare(
    "INSERT INTO stage_log (work_order_id, stage, changed_by) VALUES (?, 'Dispatched', ?)"
  ).bind(work_order_id, data.user?.name || "dispatch").run();

  return Response.json({ ok: true });
}
