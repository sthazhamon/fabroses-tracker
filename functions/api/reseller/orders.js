export async function onRequestGet({ env, data }) {
  const resellerName = data.user?.resellerName;
  if (!resellerName) {
    return Response.json({ error: "This login isn't linked to a reseller name — ask an admin to fix it in Users." }, { status: 400 });
  }

  const { results: orders } = await env.DB.prepare(
    `SELECT id, description, stage, dispatch_date, tracking_id, courier, created_at
     FROM work_orders WHERE reseller_name = ? ORDER BY created_at DESC`
  ).bind(resellerName).all();

  const { results: sales } = await env.DB.prepare(
    "SELECT id, description, sale_price, sale_date FROM sales WHERE reseller_name = ? ORDER BY sale_date DESC"
  ).bind(resellerName).all();

  return Response.json({ resellerName, orders, sales });
}
