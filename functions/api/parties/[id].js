import { logEdits } from "../_editlog.js";

export async function onRequestPatch({ request, env, params, data }) {
  const body = await request.json();
  const existing = await env.DB.prepare("SELECT * FROM parties WHERE id = ?").bind(params.id).first();
  if (!existing) return Response.json({ error: "Party not found" }, { status: 404 });

  const editable = ["phone", "notes", "opening_balance"];
  const changes = {};
  for (const field of editable) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (!Object.keys(changes).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  await logEdits(env, "party", params.id, existing, changes, data.user?.name);

  const setClauses = Object.keys(changes).map((f) => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE parties SET ${setClauses} WHERE id = ?`).bind(...Object.values(changes), params.id).run();

  return Response.json({ ok: true });
}
