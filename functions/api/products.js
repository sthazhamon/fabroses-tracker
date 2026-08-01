export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT p.*, c.name AS category_name, f.name AS fabric_name, w.name AS work_type_name, pt.name AS pattern_name
     FROM products p
     LEFT JOIN item_categories c ON c.id = p.category_id
     LEFT JOIN item_fabrics f ON f.id = p.fabric_id
     LEFT JOIN item_work_types w ON w.id = p.work_type_id
     LEFT JOIN item_patterns pt ON pt.id = p.pattern_id
     ORDER BY p.created_at DESC`
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
  const { name, category, color, price, cost, stock_qty, description, category_id, fabric_id, work_type_id, pattern_id } = body;

  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM products").first();
  const id = "PRD-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  // Derive the human-readable part number if all four dimensions were given —
  // it's entirely optional, existing products without it are unaffected.
  let itemCode = null;
  if (category_id && fabric_id && work_type_id && pattern_id) {
    const cat = await env.DB.prepare("SELECT code FROM item_categories WHERE id = ?").bind(category_id).first();
    const fab = await env.DB.prepare("SELECT code FROM item_fabrics WHERE id = ?").bind(fabric_id).first();
    const wrk = await env.DB.prepare("SELECT code FROM item_work_types WHERE id = ?").bind(work_type_id).first();
    const pat = await env.DB.prepare("SELECT code FROM item_patterns WHERE id = ?").bind(pattern_id).first();
    if (cat && fab && wrk && pat) {
      const sameComboCount = await env.DB.prepare(
        "SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND fabric_id = ? AND work_type_id = ? AND pattern_id = ?"
      ).bind(category_id, fabric_id, work_type_id, pattern_id).first();
      const seq = String((sameComboCount?.c || 0) + 1).padStart(4, "0");
      itemCode = `FR-${cat.code}-${fab.code}-${wrk.code}-${pat.code}-${seq}`;
    }
  }

  await env.DB.prepare(
    `INSERT INTO products (id, name, category, color, price, cost, stock_qty, description, category_id, fabric_id, work_type_id, pattern_id, item_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name, category || null, color || null,
    price || null, cost || null, stock_qty || 0, description || null,
    category_id || null, fabric_id || null, work_type_id || null, pattern_id || null, itemCode
  ).run();

  return Response.json({ id, item_code: itemCode });
}
