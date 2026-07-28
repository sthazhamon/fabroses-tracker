export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM purchases ORDER BY purchase_date DESC, id DESC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { supplier_name, amount, amount_paid, paid_by, description, purchase_date } = body;

  if (!amount) {
    return Response.json({ error: "amount is required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM purchases").first();
  const id = "PUR-" + String((countRow?.c || 0) + 1).padStart(6, "0");
  const effectiveDate = purchase_date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO purchases (id, supplier_name, amount, amount_paid, paid_by, description, purchase_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, supplier_name || null, amount, amount_paid || 0, paid_by || null, description || null, effectiveDate).run();

  await env.DB.prepare(
    `INSERT INTO ledger_transactions (date, type, reference_id, party, amount, direction, notes)
     VALUES (?, 'purchase', ?, ?, ?, 'debit', ?)`
  ).bind(effectiveDate, id, supplier_name || "", amount, description || "").run();

  return Response.json({ id });
}
