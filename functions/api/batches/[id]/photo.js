export async function onRequestPost({ request, env, params }) {
  const form = await request.formData();
  const file = form.get("photo");
  const stage = form.get("stage") || "intake";

  if (!file || typeof file === "string") {
    return Response.json({ error: "photo file is required" }, { status: 400 });
  }

  const ext = (file.type && file.type.split("/")[1]) || "jpg";
  const key = `batches/${params.id}/${Date.now()}.${ext}`;

  await env.PHOTOS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "image/jpeg" },
  });

  await env.DB.prepare(
    "INSERT INTO photos (entity_type, entity_id, stage, r2_key) VALUES ('batch', ?, ?, ?)"
  ).bind(params.id, stage, key).run();

  return Response.json({ ok: true, key, url: `/api/photo/${key}` });
}
