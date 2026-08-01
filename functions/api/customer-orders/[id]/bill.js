export async function onRequestPost({ request, env, params }) {
  const body = await request.json();
  const { sale_price, amount_received, sale_date } = body;

  if (!sale_price) return Response.json({ error: "sale_price is required" }, { status: 400 });

  const order = await env.DB.prepare("SELECT * FROM customer_orders WHERE id = ?").bind(params.id).first();
  if (!order) return Response.json({ error: "Customer order not found" }, { status: 404 });
  if (["billed", "shipped", "cancelled"].includes(order.status)) {
    return Response.json({ error: `This order is already ${order.status} — can't bill it again` }, { status: 400 });
  }

  // Re-check stock right now, not just whatever the order's status said
  // earlier — that status could be stale if something else sold in between.
  if (order.product_id) {
    const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(order.product_id).first();
    if (!product) return Response.json({ error: "The linked catalog item no longer exists" }, { status: 404 });
    if (product.stock_qty < order.quantity) {
      return Response.json({ error: `Only ${product.stock_qty} unit(s) of ${product.name} in stock — not enough to bill this order yet` }, { status: 400 });
    }
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM sales").first();
  const saleId = "SALE-" + String((countRow?.c || 0) + 1).padStart(6, "0");
  const effectiveDate = sale_date || new Date().toISOString().slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO sales (id, work_order_id, product_id, quantity, description, customer_name, sale_price, amount_received, sale_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    saleId, order.linked_work_order_id || null, order.product_id || null, order.quantity,
    order.description, order.customer_name, sale_price, amount_received || 0, effectiveDate
  ).run();

  if (order.product_id) {
    await env.DB.prepare("UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?").bind(order.quantity, order.product_id).run();
  }

  await env.DB.prepare(
    `INSERT INTO ledger_transactions (date, type, reference_id, party, amount, direction, notes)
     VALUES (?, 'sale', ?, ?, ?, 'credit', ?)`
  ).bind(effectiveDate, saleId, order.customer_name, sale_price, order.description).run();

  await env.DB.prepare(
    "UPDATE customer_orders SET status = 'billed', sale_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(saleId, params.id).run();

  return Response.json({ ok: true, sale_id: saleId });
}
