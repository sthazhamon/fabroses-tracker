export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT po.*, m.name AS material_name
     FROM purchase_orders po
     LEFT JOIN materials m ON m.id = po.material_id
     ORDER BY po.created_at DESC`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { supplier_name, material_id, metres_ordered, rate_per_metre, expected_date, notes } = body;

  if (!supplier_name || !material_id || !metres_ordered) {
    return Response.json({ error: "supplier_name, material_id, and metres_ordered are required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM purchase_orders").first();
  const id = "PO-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  await env.DB.prepare(
    `INSERT INTO purchase_orders (id, supplier_name, material_id, metres_ordered, rate_per_metre, expected_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, supplier_name, material_id, metres_ordered, rate_per_metre || null, expected_date || null, notes || null).run();

  return Response.json({ id });
}
