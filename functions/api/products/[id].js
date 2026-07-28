export async function onRequestGet({ params, env }) {
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(params.id).first();
  if (!product) return Response.json({ error: "not found" }, { status: 404 });

  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM product_photos WHERE product_id = ? ORDER BY uploaded_at DESC"
  ).bind(params.id).all();

  return Response.json({ ...product, photos });
}

export async function onRequestPatch({ request, env, params }) {
  const body = await request.json();
  const { price, cost, stock_qty, description } = body;

  const fields = [];
  const values = [];
  if (price !== undefined) { fields.push("price = ?"); values.push(price); }
  if (cost !== undefined) { fields.push("cost = ?"); values.push(cost); }
  if (stock_qty !== undefined) { fields.push("stock_qty = ?"); values.push(stock_qty); }
  if (description !== undefined) { fields.push("description = ?"); values.push(description); }

  if (!fields.length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  values.push(params.id);
  await env.DB.prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
  return Response.json({ ok: true });
}
