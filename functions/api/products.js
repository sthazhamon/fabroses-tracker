export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM products ORDER BY created_at DESC"
  ).all();

  // Attach a cover photo (first uploaded) per product in one extra query rather
  // than N+1 queries — cheap at this table size.
  const { results: photos } = await env.DB.prepare(
    "SELECT product_id, r2_key, uploaded_at FROM product_photos ORDER BY uploaded_at ASC"
  ).all();
  const coverByProduct = {};
  for (const p of photos) {
    if (!coverByProduct[p.product_id]) coverByProduct[p.product_id] = p.r2_key;
  }
  const withCover = results.map((r) => ({ ...r, cover_photo: coverByProduct[r.id] || null }));

  return Response.json(withCover);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name, category, color, price, cost, stock_qty, description } = body;

  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM products").first();
  const id = "PRD-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  await env.DB.prepare(
    `INSERT INTO products (id, name, category, color, price, cost, stock_qty, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name, category || null, color || null,
    price || null, cost || null, stock_qty || 0, description || null
  ).run();

  return Response.json({ id });
}
