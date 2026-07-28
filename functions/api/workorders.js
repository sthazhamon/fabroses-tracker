export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT w.*, wk.name AS worker_name
     FROM work_orders w
     LEFT JOIN workers wk ON wk.id = w.worker_id
     ORDER BY w.created_at DESC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    order_date, customer_name, reseller_name, description,
    worker_id, material_batch_id, metres_used,
  } = body;

  if (!description) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM work_orders").first();
  const nextNum = (countRow?.c || 0) + 1;
  const id = "WO-" + String(nextNum).padStart(6, "0");

  await env.DB.prepare(
    `INSERT INTO work_orders
     (id, order_date, customer_name, reseller_name, description, worker_id, material_batch_id, metres_used, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Order Placed')`
  ).bind(
    id, order_date || null, customer_name || null, reseller_name || null,
    description, worker_id || null, material_batch_id || null, metres_used || null
  ).run();

  // Deduct fabric consumption from the raw material batch balance, if a batch was linked
  if (material_batch_id && metres_used) {
    await env.DB.prepare(
      "UPDATE material_batches SET metres_balance = metres_balance - ? WHERE id = ?"
    ).bind(metres_used, material_batch_id).run();
  }

  await env.DB.prepare(
    "INSERT INTO stage_log (work_order_id, stage, changed_by) VALUES (?, 'Order Placed', 'system')"
  ).bind(id).run();

  return Response.json({ id });
}
