export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const party = url.searchParams.get("party");

  let query = "SELECT * FROM payments";
  const params = [];
  if (party) { query += " WHERE party_name = ?"; params.push(party); }
  query += " ORDER BY payment_date DESC, id DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { party_name, direction, amount, payment_date, notes } = body;

  if (!party_name || !amount || !["in", "out"].includes(direction)) {
    return Response.json({ error: "party_name, amount, and direction ('in' or 'out') are required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM payments").first();
  const id = "PAY-" + String((countRow?.c || 0) + 1).padStart(6, "0");
  const effectiveDate = payment_date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    "INSERT INTO payments (id, party_name, direction, amount, payment_date, notes) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, party_name, direction, amount, effectiveDate, notes || null).run();

  return Response.json({ id });
}
