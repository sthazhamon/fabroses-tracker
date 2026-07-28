export async function onRequestGet({ params, env }) {
  const order = await env.DB.prepare(
    `SELECT w.*, wk.name AS worker_name
     FROM work_orders w
     LEFT JOIN workers wk ON wk.id = w.worker_id
     WHERE w.id = ?`
  ).bind(params.id).first();

  if (!order) return Response.json({ error: "not found" }, { status: 404 });

  const { results: stages } = await env.DB.prepare(
    "SELECT * FROM stage_log WHERE work_order_id = ? ORDER BY changed_at ASC"
  ).bind(params.id).all();

  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM photos WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY uploaded_at DESC"
  ).bind(params.id).all();

  return Response.json({ ...order, stages, photos });
}
