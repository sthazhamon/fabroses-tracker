export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM suppliers ORDER BY id DESC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name, phone, notes } = body;
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const res = await env.DB.prepare(
    "INSERT INTO suppliers (name, phone, notes) VALUES (?, ?, ?)"
  ).bind(name, phone || null, notes || null).run();

  return Response.json({ id: res.meta.last_row_id });
}
