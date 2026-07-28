export async function onRequestGet({ params, env }) {
  const code = params.code.toUpperCase();

  if (code.startsWith("RM-")) {
    const batch = await env.DB.prepare(
      `SELECT b.*, m.name AS material_name, m.color, s.name AS supplier_name
       FROM material_batches b
       LEFT JOIN materials m ON m.id = b.material_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.id = ?`
    ).bind(code).first();

    if (!batch) return Response.json({ error: "not found" }, { status: 404 });

    const { results: photos } = await env.DB.prepare(
      "SELECT * FROM photos WHERE entity_type = 'batch' AND entity_id = ? ORDER BY uploaded_at DESC"
    ).bind(code).all();

    return Response.json({ type: "batch", ...batch, photos });
  }

  if (code.startsWith("WO-")) {
    const order = await env.DB.prepare(
      `SELECT w.*, wk.name AS worker_name
       FROM work_orders w
       LEFT JOIN workers wk ON wk.id = w.worker_id
       WHERE w.id = ?`
    ).bind(code).first();

    if (!order) return Response.json({ error: "not found" }, { status: 404 });

    const { results: stages } = await env.DB.prepare(
      "SELECT * FROM stage_log WHERE work_order_id = ? ORDER BY changed_at ASC"
    ).bind(code).all();

    const { results: photos } = await env.DB.prepare(
      "SELECT * FROM photos WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY uploaded_at DESC"
    ).bind(code).all();

    return Response.json({ type: "work_order", ...order, stages, photos });
  }

  return Response.json({ error: "unrecognized code format" }, { status: 400 });
}
