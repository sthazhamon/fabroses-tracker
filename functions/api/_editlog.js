// Shared helper — not a route (underscore prefix). Records one edit_log row
// per changed field, comparing old vs new values so nothing gets silently
// overwritten without a trace.

export async function logEdits(env, entityType, entityId, oldRow, changes, editedBy) {
  for (const [field, newValue] of Object.entries(changes)) {
    const oldValue = oldRow[field];
    if (String(oldValue ?? "") === String(newValue ?? "")) continue; // no actual change
    await env.DB.prepare(
      `INSERT INTO edit_log (entity_type, entity_id, field, old_value, new_value, edited_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(entityType, entityId, field, oldValue === undefined ? null : String(oldValue ?? ""), String(newValue ?? ""), editedBy || "unknown").run();
  }
}
