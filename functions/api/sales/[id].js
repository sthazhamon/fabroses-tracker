import { logEdits } from "../_editlog.js";

export async function onRequestPatch({ request, env, params, data }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Sale not found" }, { status: 404 });

  const editable = ["description", "customer_name", "reseller_name", "sale_price", "amount_received", "sale_date", "product_id", "quantity"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  // If the linked catalog item or quantity is changing, stock has to move too —
  // give back what the OLD sale had reserved, then take the NEW amount, so
  // stock never drifts out of sync with what's actually been sold.
  const productOrQtyChanging = changes.product_id !== undefined || changes.quantity !== undefined;
  if (productOrQtyChanging) {
    if (existing.product_id) {
      await env.DB.prepare("UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?").bind(existing.quantity || 1, existing.product_id).run();
    }
    const newProductId = changes.product_id !== undefined ? changes.product_id : existing.product_id;
    const newQty = changes.quantity !== undefined ? changes.quantity : (existing.quantity || 1);
    if (newProductId) {
      const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(newProductId).first();
      if (!product) {
        if (existing.product_id) {
          await env.DB.prepare("UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?").bind(existing.quantity || 1, existing.product_id).run();
        }
        return Response.json({ error: "That product code doesn't exist in the catalog" }, { status: 404 });
      }
      if (product.stock_qty < newQty) {
        if (existing.product_id) {
          await env.DB.prepare("UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?").bind(existing.quantity || 1, existing.product_id).run();
        }
        return Response.json({ error: `Only ${product.stock_qty} unit(s) of ${product.name} in stock` }, { status: 400 });
      }
      await env.DB.prepare("UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?").bind(newQty, newProductId).run();
    }
  }

  await logEdits(env, "sale", params.id, existing, changes, data.user?.name);

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE sales SET ${setClauses} WHERE id = ?`).bind(...Object.values(changes), params.id).run();

  // Keep the ledger's mirror of this transaction in sync, so P&L stays accurate.
  if (changes.sale_price !== undefined || changes.sale_date !== undefined || changes.description !== undefined
    || changes.customer_name !== undefined || changes.reseller_name !== undefined) {
    const updated = await env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(params.id).first();
    await env.DB.prepare(
      "UPDATE ledger_transactions SET date = ?, amount = ?, party = ?, notes = ? WHERE type = 'sale' AND reference_id = ?"
    ).bind(updated.sale_date, updated.sale_price, updated.customer_name || updated.reseller_name || "", updated.description, params.id).run();
  }

  return Response.json({ ok: true });
}
