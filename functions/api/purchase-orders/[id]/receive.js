export async function onRequestPost({ request, env, params }) {
  const body = await request.json();
  const { metres_received, purchase_amount, supplier_id, notes } = body;

  if (!metres_received) {
    return Response.json({ error: "metres_received is required" }, { status: 400 });
  }

  const po = await env.DB.prepare("SELECT * FROM purchase_orders WHERE id = ?").bind(params.id).first();
  if (!po) return Response.json({ error: "Purchase order not found" }, { status: 404 });
  if (po.status === "cancelled") return Response.json({ error: "This purchase order was cancelled" }, { status: 400 });

  const totalReceived = po.metres_received + metres_received;
  if (totalReceived > po.metres_ordered) {
    return Response.json({ error: `Only ${po.metres_ordered - po.metres_received}m still outstanding on this order` }, { status: 400 });
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM material_batches").first();
  const batchId = "RM-" + String((countRow?.c || 0) + 1).padStart(6, "0");

  await env.DB.prepare(
    `INSERT INTO material_batches
     (id, material_id, supplier_id, metres_received, metres_balance, purchase_amount, purchase_date, notes, purchase_order_id)
     VALUES (?, ?, ?, ?, ?, ?, date('now'), ?, ?)`
  ).bind(
    batchId, po.material_id, supplier_id || null, metres_received, metres_received,
    purchase_amount || null, notes || null, po.id
  ).run();

  await env.DB.prepare(
    `INSERT INTO inventory_log (item_type, item_ref, event, quantity, from_location, to_location, notes)
     VALUES ('raw_material', ?, 'received_into_store', ?, 'Supplier', 'Store', ?)`
  ).bind(batchId, metres_received, `Received against ${po.id}`).run();

  const newStatus = totalReceived >= po.metres_ordered ? "received" : "partially_received";
  await env.DB.prepare(
    "UPDATE purchase_orders SET metres_received = ?, status = ? WHERE id = ?"
  ).bind(totalReceived, newStatus, po.id).run();

  return Response.json({ batch_id: batchId, po_status: newStatus });
}
