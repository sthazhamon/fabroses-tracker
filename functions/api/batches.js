export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT b.*, m.name AS material_name, m.color, s.name AS supplier_name
     FROM material_batches b
     LEFT JOIN materials m ON m.id = b.material_id
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     ORDER BY b.created_at DESC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { material_id, supplier_id, metres_received, purchase_amount, purchase_date, notes } = body;

  if (!material_id || !metres_received) {
    return Response.json({ error: "material_id and metres_received are required" }, { status: 400 });
  }

  // Generate sequential batch code: RM-000123 (this string is what gets encoded in the QR label)
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM material_batches").first();
  const nextNum = (countRow?.c || 0) + 1;
  const id = "RM-" + String(nextNum).padStart(6, "0");

  await env.DB.prepare(
    `INSERT INTO material_batches
     (id, material_id, supplier_id, metres_received, metres_balance, purchase_amount, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, material_id, supplier_id || null, metres_received,
    metres_received, purchase_amount || null, purchase_date || null, notes || null
  ).run();

  return Response.json({ id });
}
