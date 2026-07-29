async function computeBalance(env, party) {
  if (party.type === "customer" || party.type === "reseller") {
    const col = party.type === "customer" ? "customer_name" : "reseller_name";
    const billedRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(sale_price),0) AS billed, COALESCE(SUM(amount_received),0) AS received
       FROM sales WHERE ${col} = ?`
    ).bind(party.name).first();
    const paymentsRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE party_name = ? AND direction = 'in'"
    ).bind(party.name).first();
    const balance = party.opening_balance + billedRow.billed - billedRow.received - paymentsRow.total;
    return { balance: Math.round(balance * 100) / 100, billed: billedRow.billed, settled: billedRow.received + paymentsRow.total };
  }
  if (party.type === "supplier") {
    const billedRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount),0) AS billed, COALESCE(SUM(amount_paid),0) AS paid
       FROM purchases WHERE supplier_name = ?`
    ).bind(party.name).first();
    const paymentsRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE party_name = ? AND direction = 'out'"
    ).bind(party.name).first();
    const balance = party.opening_balance + billedRow.billed - billedRow.paid - paymentsRow.total;
    return { balance: Math.round(balance * 100) / 100, billed: billedRow.billed, settled: billedRow.paid + paymentsRow.total };
  }
  // worker / other — no automatic transaction linkage yet, just the opening balance
  return { balance: party.opening_balance, billed: 0, settled: 0 };
}

export async function onRequestGet({ env }) {
  const { results: parties } = await env.DB.prepare("SELECT * FROM parties ORDER BY name ASC").all();
  const withBalances = [];
  for (const party of parties) {
    const b = await computeBalance(env, party);
    withBalances.push({ ...party, ...b });
  }
  return Response.json(withBalances);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const name = (body.name || "").trim();
  const type = body.type;
  const validTypes = ["customer", "reseller", "supplier", "worker", "other"];

  if (!name || !validTypes.includes(type)) {
    return Response.json({ error: `name and a valid type (${validTypes.join(", ")}) are required` }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM parties").first();
  const id = "PTY-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  try {
    await env.DB.prepare(
      "INSERT INTO parties (id, name, type, phone, notes, opening_balance) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, name, type, body.phone || null, body.notes || null, body.opening_balance || 0).run();
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: "A party with that name already exists" }, { status: 400 });
  }
}
