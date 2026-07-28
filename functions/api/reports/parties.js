async function buildBalances(env, { billedQuery, receivedField, paymentsDirection }) {
  const { results: billedRows } = await env.DB.prepare(billedQuery).all();
  const { results: paymentRows } = await env.DB.prepare(
    "SELECT party_name, SUM(amount) AS total FROM payments WHERE direction = ? GROUP BY party_name"
  ).bind(paymentsDirection).all();

  const paymentsByParty = {};
  for (const p of paymentRows) paymentsByParty[p.party_name] = p.total;

  return billedRows.map((row) => {
    const extraPayments = paymentsByParty[row.party] || 0;
    const outstanding = row.billed - row[receivedField] - extraPayments;
    return {
      party: row.party,
      billed: row.billed,
      received_or_paid_at_time: row[receivedField],
      additional_payments: extraPayments,
      outstanding: Math.round(outstanding * 100) / 100,
    };
  }).sort((a, b) => b.outstanding - a.outstanding);
}

export async function onRequestGet({ env }) {
  const customers = await buildBalances(env, {
    billedQuery: `SELECT customer_name AS party, SUM(sale_price) AS billed, SUM(amount_received) AS received
                  FROM sales WHERE customer_name IS NOT NULL AND customer_name != '' GROUP BY customer_name`,
    receivedField: "received",
    paymentsDirection: "in",
  });

  const resellers = await buildBalances(env, {
    billedQuery: `SELECT reseller_name AS party, SUM(sale_price) AS billed, SUM(amount_received) AS received
                  FROM sales WHERE reseller_name IS NOT NULL AND reseller_name != '' GROUP BY reseller_name`,
    receivedField: "received",
    paymentsDirection: "in",
  });

  const suppliers = await buildBalances(env, {
    billedQuery: `SELECT supplier_name AS party, SUM(amount) AS billed, SUM(amount_paid) AS paid
                  FROM purchases WHERE supplier_name IS NOT NULL AND supplier_name != '' GROUP BY supplier_name`,
    receivedField: "paid",
    paymentsDirection: "out",
  });

  return Response.json({ customers, resellers, suppliers });
}
