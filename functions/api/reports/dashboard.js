export async function onRequestGet({ env }) {
  const pendingByStage = await env.DB.prepare(
    "SELECT stage, COUNT(*) AS count FROM work_orders WHERE stage != 'Delivered' GROUP BY stage"
  ).all();

  const wipByWorker = await env.DB.prepare(
    `SELECT COALESCE(wk.name, 'Unassigned') AS worker, COUNT(*) AS count
     FROM work_orders w
     LEFT JOIN workers wk ON wk.id = w.worker_id
     WHERE w.stage NOT IN ('Delivered', 'Dispatched')
     GROUP BY worker`
  ).all();

  const lowStock = await env.DB.prepare(
    `SELECT b.id, m.name AS material_name, b.metres_balance
     FROM material_batches b
     LEFT JOIN materials m ON m.id = b.material_id
     WHERE b.metres_balance < 5
     ORDER BY b.metres_balance ASC`
  ).all();

  const todaySales = await env.DB.prepare(
    "SELECT COALESCE(SUM(sale_price),0) AS total, COUNT(*) AS count FROM sales WHERE date(sale_date) = date('now')"
  ).first();

  const overdueDispatch = await env.DB.prepare(
    `SELECT id, description, updated_at FROM work_orders
     WHERE stage = 'Packed' AND datetime(updated_at) < datetime('now', '-3 days')`
  ).all();

  return Response.json({
    pendingByStage: pendingByStage.results,
    wipByWorker: wipByWorker.results,
    lowStock: lowStock.results,
    todaySales,
    overdueDispatch: overdueDispatch.results,
  });
}
