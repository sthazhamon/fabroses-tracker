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

  // Overdue now means past its actual due date, not just "sat in Packed too long" —
  // falls back to the old Packed-stage heuristic for orders that never got a due date set.
  const overdueDispatch = await env.DB.prepare(
    `SELECT id, description, due_date, updated_at FROM work_orders
     WHERE stage NOT IN ('Delivered', 'Dispatched')
       AND (
         (due_date IS NOT NULL AND date(due_date) < date('now'))
         OR (due_date IS NULL AND stage = 'Packed' AND datetime(updated_at) < datetime('now', '-3 days'))
       )`
  ).all();

  const urgentOpenOrders = await env.DB.prepare(
    `SELECT id, description, due_date, stage FROM work_orders
     WHERE priority = 'urgent' AND stage NOT IN ('Delivered', 'Dispatched')
     ORDER BY due_date ASC`
  ).all();

  const outstandingSummary = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(sale_price - amount_received), 0) FROM sales) AS customer_owed_to_us,
       (SELECT COALESCE(SUM(amount - amount_paid), 0) FROM purchases) AS we_owe_suppliers`
  ).first();

  return Response.json({
    pendingByStage: pendingByStage.results,
    wipByWorker: wipByWorker.results,
    lowStock: lowStock.results,
    todaySales,
    overdueDispatch: overdueDispatch.results,
    urgentOpenOrders: urgentOpenOrders.results,
    outstandingSummary,
  });
}
