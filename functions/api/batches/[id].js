export async function onRequestGet({ params, env }) {
  const batch = await env.DB.prepare(
    `SELECT b.*, m.name AS material_name, m.color, s.name AS supplier_name
     FROM material_batches b
     LEFT JOIN materials m ON m.id = b.material_id
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     WHERE b.id = ?`
  ).bind(params.id).first();

  if (!batch) return Response.json({ error: "not found" }, { status: 404 });

  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM photos WHERE entity_type = 'batch' AND entity_id = ? ORDER BY uploaded_at DESC"
  ).bind(params.id).all();

  return Response.json({ ...batch, photos });
}
