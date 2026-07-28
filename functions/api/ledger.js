export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = "SELECT * FROM ledger_transactions";
  const params = [];
  if (from && to) {
    query += " WHERE date(date) BETWEEN date(?) AND date(?)";
    params.push(from, to);
  }
  query += " ORDER BY date DESC, id DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return Response.json(results);
}
