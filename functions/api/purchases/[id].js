import { logEdits } from "../_editlog.js";

export async function onRequestPatch({ request, env, params, data }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Purchase not found" }, { status: 404 });

  const editable = ["supplier_name", "amount", "amount_paid", "paid_by", "description", "purchase_date"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  await logEdits(env, "purchase", params.id, existing, changes, data.user?.name);

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE purchases SET ${setClauses} WHERE id = ?`).bind(...Object.values(changes), params.id).run();

  if (changes.amount !== undefined || changes.purchase_date !== undefined || changes.description !== undefined || changes.supplier_name !== undefined) {
    const updated = await env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(params.id).first();
    await env.DB.prepare(
      "UPDATE ledger_transactions SET date = ?, amount = ?, party = ?, notes = ? WHERE type = 'purchase' AND reference_id = ?"
    ).bind(updated.purchase_date, updated.amount, updated.supplier_name || "", updated.description || "", params.id).run();
  }

  return Response.json({ ok: true });
}
