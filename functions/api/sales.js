export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM sales ORDER BY sale_date DESC, id DESC"
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const {
    work_order_id, description, customer_name, reseller_name,
    sale_price, amount_received, sale_date, received_by,
  } = body;

  if (!description || !sale_price) {
    return Response.json({ error: "description and sale_price are required" }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM sales").first();
  const id = "SALE-" + String((countRow?.c || 0) + 1).padStart(6, "0");
  const effectiveDate = sale_date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO sales
     (id, work_order_id, description, customer_name, reseller_name, sale_price, amount_received, sale_date, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, work_order_id || null, description, customer_name || null, reseller_name || null,
    sale_price, amount_received || 0, effectiveDate, received_by || null
  ).run();

  await env.DB.prepare(
    `INSERT INTO ledger_transactions (date, type, reference_id, party, amount, direction, notes)
     VALUES (?, 'sale', ?, ?, ?, 'credit', ?)`
  ).bind(effectiveDate, id, customer_name || reseller_name || "", sale_price, description).run();

  return Response.json({ id });
}
