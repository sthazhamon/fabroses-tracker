export async function onRequestGet({ env }) {
  const { results: storeRaw } = await env.DB.prepare(
    `SELECT b.id, m.name AS material_name, b.metres_balance
     FROM material_batches b LEFT JOIN materials m ON m.id = b.material_id
     WHERE b.metres_balance > 0 ORDER BY b.metres_balance DESC`
  ).all();

  const { results: withWorkers } = await env.DB.prepare(
    `SELECT mi.worker_name, mi.material_batch_id, mi.work_order_id, mi.metres_issued, mi.issued_at,
            m.name AS material_name, w.description AS order_description
     FROM material_issues mi
     LEFT JOIN material_batches b ON b.id = mi.material_batch_id
     LEFT JOIN materials m ON m.id = b.material_id
     LEFT JOIN work_orders w ON w.id = mi.work_order_id
     WHERE mi.status = 'with_worker'
     ORDER BY mi.worker_name ASC, mi.issued_at ASC`
  ).all();

  const { results: finishedStock } = await env.DB.prepare(
    "SELECT id, name, category, stock_qty FROM products ORDER BY stock_qty DESC"
  ).all();

  return Response.json({ storeRaw, withWorkers, finishedStock });
}
