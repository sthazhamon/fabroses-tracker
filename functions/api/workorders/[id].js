import { logEdits } from "../_editlog.js";

export async function onRequestGet({ params, env }) {
  const order = await env.DB.prepare(
    `SELECT w.*, wk.name AS worker_name
     FROM work_orders w
     LEFT JOIN workers wk ON wk.id = w.worker_id
     WHERE w.id = ?`
  ).bind(params.id).first();

  if (!order) return Response.json({ error: "not found" }, { status: 404 });

  const { results: stages } = await env.DB.prepare(
    "SELECT * FROM stage_log WHERE work_order_id = ? ORDER BY changed_at ASC"
  ).bind(params.id).all();

  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM photos WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY uploaded_at DESC"
  ).bind(params.id).all();

  const { results: issues } = await env.DB.prepare(
    "SELECT * FROM material_issues WHERE work_order_id = ? ORDER BY issued_at ASC"
  ).bind(params.id).all();

  const { results: trace } = await env.DB.prepare(
    "SELECT * FROM inventory_log WHERE work_order_id = ? ORDER BY created_at ASC"
  ).bind(params.id).all();

  return Response.json({ ...order, stages, photos, issues, trace });
}

export async function onRequestPatch({ request, env, params, data }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Work order not found" }, { status: 404 });

  const editable = ["description", "work_instructions", "due_date", "priority", "customer_name", "reseller_name"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  await logEdits(env, "work_order", params.id, existing, changes, data.user?.name);

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE work_orders SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).bind(...Object.values(changes), params.id).run();

  return Response.json({ ok: true });
}
