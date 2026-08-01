export async function onRequestPost({ request, env, params, data }) {
  const body = await request.json();
  const { delta, reason } = body;

  if (!delta) return Response.json({ error: "delta is required (positive to add, negative to remove)" }, { status: 400 });

  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(params.id).first();
  if (!product) return Response.json({ error: "Product not found" }, { status: 404 });

  const newQty = product.stock_qty + delta;
  if (newQty < 0) {
    return Response.json({ error: `Only ${product.stock_qty} unit(s) currently in stock — can't remove ${Math.abs(delta)}` }, { status: 400 });
  }

  await env.DB.prepare("UPDATE products SET stock_qty = ? WHERE id = ?").bind(newQty, params.id).run();

  await env.DB.prepare(
    `INSERT INTO inventory_log (item_type, item_ref, event, quantity, from_location, to_location, notes, created_by)
     VALUES ('finished_good', ?, 'adjusted', ?, ?, ?, ?, ?)`
  ).bind(
    params.id, Math.abs(delta),
    delta < 0 ? "Store" : null, delta > 0 ? "Store" : null,
    reason || null, data.user?.name || "unknown"
  ).run();

  return Response.json({ ok: true, new_stock_qty: newQty });
}
