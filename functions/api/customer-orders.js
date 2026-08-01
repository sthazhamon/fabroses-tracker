export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT co.*, p.name AS product_name, p.item_code
     FROM customer_orders co
     LEFT JOIN products p ON p.id = co.product_id
     ORDER BY co.created_at DESC`
  ).all();
  return Response.json(results);
}

async function nextWorkOrderId(env) {
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM work_orders").first();
  return "WO-" + String((countRow?.c || 0) + 1).padStart(6, "0");
}

export async function onRequestPost({ request, env, data }) {
  const body = await request.json();
  const { customer_name, customer_phone, product_id, description, quantity, order_date, promised_delivery_date, notes } = body;

  if (!customer_name) return Response.json({ error: "customer_name is required" }, { status: 400 });
  if (!product_id && !description) {
    return Response.json({ error: "Provide either an existing catalog product_id, or a description for a fully custom order" }, { status: 400 });
  }

  const qty = quantity || 1;
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM customer_orders").first();
  const orderId = "CO-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  let status = "received";
  let linkedWorkOrderId = null;
  let effectiveDescription = description || null;
  let needsMaterial = false;

  if (product_id) {
    const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(product_id).first();
    if (!product) return Response.json({ error: "That product code doesn't exist in the catalog" }, { status: 404 });
    if (!effectiveDescription) effectiveDescription = product.name;

    if (product.stock_qty >= qty) {
      // Enough in stock right now — informational only. Actual stock isn't
      // reserved/decremented until billing, which re-checks availability at
      // that moment (so two orders racing for the last piece can't both win).
      status = "stock_available";
    } else {
      // Not enough in stock — is anyone already making more of this design?
      const openWO = await env.DB.prepare(
        `SELECT * FROM work_orders WHERE intended_product_id = ? AND stage NOT IN ('Delivered', 'Dispatched') LIMIT 1`
      ).bind(product_id).first();

      if (openWO) {
        status = "awaiting_wip";
        linkedWorkOrderId = openWO.id;
      } else {
        // Nothing in stock, nothing already in progress — trigger a new work
        // order. It starts life needing raw material issued to a worker.
        const newWoId = await nextWorkOrderId(env);
        await env.DB.prepare(
          `INSERT INTO work_orders (id, description, order_type, intended_product_id, stage, order_date)
           VALUES (?, ?, 'custom', ?, 'Order Placed', date('now'))`
        ).bind(newWoId, `Replenish stock: ${product.name} (for order ${orderId})`, product_id).run();
        await env.DB.prepare(
          "INSERT INTO stage_log (work_order_id, stage, changed_by) VALUES (?, 'Order Placed', 'system')"
        ).bind(newWoId).run();

        status = "awaiting_material";
        linkedWorkOrderId = newWoId;
        needsMaterial = true;
      }
    }
  } else {
    // Fully custom, no catalog match — always goes straight to production.
    const newWoId = await nextWorkOrderId(env);
    await env.DB.prepare(
      `INSERT INTO work_orders (id, description, order_type, stage, order_date)
       VALUES (?, ?, 'custom', 'Order Placed', date('now'))`
    ).bind(newWoId, `${description} (for order ${orderId})`).run();
    await env.DB.prepare(
      "INSERT INTO stage_log (work_order_id, stage, changed_by) VALUES (?, 'Order Placed', 'system')"
    ).bind(newWoId).run();

    status = "awaiting_material";
    linkedWorkOrderId = newWoId;
    needsMaterial = true;
  }

  await env.DB.prepare(
    `INSERT INTO customer_orders
     (id, customer_name, customer_phone, product_id, description, quantity, order_date, promised_delivery_date, status, linked_work_order_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    orderId, customer_name, customer_phone || null, product_id || null, effectiveDescription, qty,
    order_date || new Date().toISOString().slice(0, 10), promised_delivery_date || null, status, linkedWorkOrderId, notes || null
  ).run();

  return Response.json({ id: orderId, status, linked_work_order_id: linkedWorkOrderId, needs_material: needsMaterial });
}
