export async function onRequestPost({ request, env, params, data }) {
  const body = await request.json();
  const { material_batch_id, metres, worker_name } = body;

  if (!material_batch_id || !metres || !worker_name) {
    return Response.json({ error: "material_batch_id, metres, and worker_name are required" }, { status: 400 });
  }

  const order = await env.DB.prepare("SELECT id FROM work_orders WHERE id = ?").bind(params.id).first();
  if (!order) return Response.json({ error: "Work order not found" }, { status: 404 });

  const batch = await env.DB.prepare("SELECT * FROM material_batches WHERE id = ?").bind(material_batch_id).first();
  if (!batch) return Response.json({ error: "Material batch not found" }, { status: 404 });
  if (batch.metres_balance < metres) {
    return Response.json({ error: `Only ${batch.metres_balance}m available in that batch` }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM material_issues").first();
  const issueId = "ISS-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  await env.DB.prepare(
    "UPDATE material_batches SET metres_balance = metres_balance - ? WHERE id = ?"
  ).bind(metres, material_batch_id).run();

  await env.DB.prepare(
    `INSERT INTO material_issues (id, work_order_id, material_batch_id, metres_issued, worker_name, status)
     VALUES (?, ?, ?, ?, ?, 'with_worker')`
  ).bind(issueId, params.id, material_batch_id, metres, worker_name).run();

  await env.DB.prepare(
    `INSERT INTO inventory_log (item_type, item_ref, work_order_id, event, quantity, from_location, to_location, notes, created_by)
     VALUES ('raw_material', ?, ?, 'issued_to_worker', ?, 'Store', ?, ?, ?)`
  ).bind(material_batch_id, params.id, metres, worker_name, `Issued for ${params.id}`, data.user?.name || "system").run();

  return Response.json({ id: issueId });
}
