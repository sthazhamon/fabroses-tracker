export async function onRequestGet({ params, env }) {
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(params.id).first();
  if (!product) return Response.json({ error: "not found" }, { status: 404 });

  const { results: workOrders } = await env.DB.prepare(
    "SELECT * FROM work_orders WHERE output_product_id = ?"
  ).bind(params.id).all();

  if (!workOrders.length) {
    // No job-work history to trace for this item — it was either entered as
    // existing/opening stock, or its stock was adjusted directly. Fall back to
    // whatever cost was manually entered on the product itself, rather than
    // silently reporting a cost of zero (which would make margin look like
    // 100% profit on stock that actually has a real, known cost).
    const costPerUnit = product.cost != null ? product.cost : null;
    return Response.json({
      product_id: product.id,
      product_name: product.name,
      cost_source: product.cost != null ? "manual" : "none",
      total_raw_material_cost: 0,
      total_labor_cost: 0,
      total_cost: costPerUnit != null ? Math.round(costPerUnit * product.stock_qty * 100) / 100 : null,
      total_units_produced: 0,
      cost_per_unit: costPerUnit,
      selling_price: product.price,
      margin_per_unit: (product.price != null && costPerUnit != null) ? Math.round((product.price - costPerUnit) * 100) / 100 : null,
      work_orders: [],
    });
  }

  const breakdown = [];
  let totalRawCost = 0;
  let totalLaborCost = 0;
  let totalUnits = 0;

  for (const wo of workOrders) {
    const { results: issues } = await env.DB.prepare(
      `SELECT mi.*, b.purchase_amount, b.metres_received, m.name AS material_name
       FROM material_issues mi
       LEFT JOIN material_batches b ON b.id = mi.material_batch_id
       LEFT JOIN materials m ON m.id = b.material_id
       WHERE mi.work_order_id = ?`
    ).bind(wo.id).all();

    let woRawCost = 0;
    // A batch's cost-per-metre is its total purchase cost divided across everything
    // it produced — this is what correctly handles the same batch feeding several
    // different work orders: each one only bears the cost of the metres IT used.
    const materialLines = issues.map((iss) => {
      const costPerMetre = (iss.purchase_amount && iss.metres_received) ? iss.purchase_amount / iss.metres_received : 0;
      const lineCost = Math.round(costPerMetre * iss.metres_issued * 100) / 100;
      woRawCost += lineCost;
      return {
        material_batch_id: iss.material_batch_id,
        material_name: iss.material_name,
        metres_issued: iss.metres_issued,
        cost_per_metre: Math.round(costPerMetre * 100) / 100,
        line_cost: lineCost,
      };
    });

    totalRawCost += woRawCost;
    totalLaborCost += wo.labor_cost || 0;
    totalUnits += wo.received_qty || 0;

    breakdown.push({
      work_order_id: wo.id,
      received_qty: wo.received_qty,
      raw_material_cost: Math.round(woRawCost * 100) / 100,
      labor_cost: wo.labor_cost || 0,
      materials: materialLines,
    });
  }

  const effectiveUnits = totalUnits || product.stock_qty || 1;
  const totalCost = Math.round((totalRawCost + totalLaborCost) * 100) / 100;
  const costPerUnit = effectiveUnits ? Math.round((totalCost / effectiveUnits) * 100) / 100 : null;

  return Response.json({
    product_id: product.id,
    product_name: product.name,
    cost_source: "work_orders",
    total_raw_material_cost: Math.round(totalRawCost * 100) / 100,
    total_labor_cost: Math.round(totalLaborCost * 100) / 100,
    total_cost: totalCost,
    total_units_produced: totalUnits,
    cost_per_unit: costPerUnit,
    selling_price: product.price,
    margin_per_unit: (product.price && costPerUnit != null) ? Math.round((product.price - costPerUnit) * 100) / 100 : null,
    work_orders: breakdown,
  });
}
