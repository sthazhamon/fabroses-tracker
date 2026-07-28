export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM workers ORDER BY name ASC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { name } = body;
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const res = await env.DB.prepare(
    "INSERT INTO workers (name) VALUES (?)"
  ).bind(name).run();

  return Response.json({ id: res.meta.last_row_id });
}
