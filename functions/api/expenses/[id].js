import { logEdits } from "../_editlog.js";

export async function onRequestPatch({ request, env, params, data }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Expense not found" }, { status: 404 });

  const editable = ["description", "category", "paid_by", "amount", "date"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  await logEdits(env, "expense", params.id, existing, changes, data.user?.name);

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE expenses SET ${setClauses} WHERE id = ?`).bind(...Object.values(changes), params.id).run();

  if (changes.amount !== undefined || changes.date !== undefined || changes.description !== undefined || changes.paid_by !== undefined) {
    const updated = await env.DB.prepare("SELECT * FROM expenses WHERE id = ?").bind(params.id).first();
    await env.DB.prepare(
      "UPDATE ledger_transactions SET date = ?, amount = ?, party = ?, notes = ? WHERE type = 'expense' AND reference_id = ?"
    ).bind(updated.date, updated.amount, updated.paid_by || "", updated.description, params.id).run();
  }

  return Response.json({ ok: true });
}
