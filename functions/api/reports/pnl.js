export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const dateClause = from && to ? " WHERE date(sale_date) BETWEEN date(?) AND date(?)" : "";
  const dateClausePurchase = from && to ? " WHERE date(purchase_date) BETWEEN date(?) AND date(?)" : "";
  const dateClauseExpense = from && to ? " WHERE date(date) BETWEEN date(?) AND date(?)" : "";
  const params = from && to ? [from, to] : [];

  const sales = await env.DB.prepare(
    `SELECT COALESCE(SUM(sale_price),0) AS total, COUNT(*) AS count FROM sales${dateClause}`
  ).bind(...params).first();

  const purchases = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM purchases${dateClausePurchase}`
  ).bind(...params).first();

  const expenses = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM expenses${dateClauseExpense}`
  ).bind(...params).first();

  const profit = sales.total - purchases.total - expenses.total;

  return Response.json({
    from: from || "all-time", to: to || "all-time",
    sales, purchases, expenses, profit,
  });
}
