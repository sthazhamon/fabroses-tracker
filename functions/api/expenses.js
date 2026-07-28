export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM expenses ORDER BY date DESC, id DESC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { date, description, category, paid_by, amount } = body;

  if (!amount || !description) {
    return Response.json({ error: "description and amount are required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM expenses").first();
  const id = "EXP-" + String((countRow?.c || 0) + 1).padStart(6, "0");
  const effectiveDate = date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    "INSERT INTO expenses (id, date, description, category, paid_by, amount) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, effectiveDate, description, category || null, paid_by || null, amount).run();

  await env.DB.prepare(
    `INSERT INTO ledger_transactions (date, type, reference_id, party, amount, direction, notes)
     VALUES (?, 'expense', ?, ?, ?, 'debit', ?)`
  ).bind(effectiveDate, id, paid_by || "", amount, description).run();

  return Response.json({ id });
}
