import { verifyToken } from "./_auth.js";

// Which roles may access each area of the API. Checked by path prefix.
// Order matters — first match wins.
const RULES = [
  { prefix: "/api/auth/", roles: null },        // public
  { prefix: "/api/photo/", roles: null },       // public (image display)
  { prefix: "/api/reseller/", roles: ["reseller", "admin"] },
  { prefix: "/api/reports/", roles: ["admin", "accountant"] },
  { prefix: "/api/ledger", roles: ["admin", "accountant"] },
  { prefix: "/api/expenses", roles: ["admin", "accountant"] },
  { prefix: "/api/purchases", roles: ["admin", "accountant"] },
  { prefix: "/api/payments", roles: ["admin", "accountant"] },
  { prefix: "/api/parties", roles: ["admin", "accountant"] },
  { prefix: "/api/sales", roles: ["admin", "accountant", "dispatch"] },
  { prefix: "/api/dispatch", roles: ["admin", "accountant", "dispatch"] },
  { prefix: "/api/purchase-orders", roles: ["admin", "accountant", "dispatch"] },
  { prefix: "/api/users", roles: ["admin"] },
  // everything else (materials, suppliers, workers, batches, workorders, scan) —
  // any signed-in staff member except reseller
  { prefix: "/api/", roles: ["admin", "accountant", "worker", "dispatch"] },
];

function rolesFor(pathname) {
  for (const rule of RULES) {
    if (pathname.startsWith(rule.prefix)) return rule.roles;
  }
  return ["admin"]; // safe default: deny unless explicitly opened up above
}

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const url = new URL(request.url);
  const allowedRoles = rolesFor(url.pathname);

  if (allowedRoles === null) {
    return next(); // public route
  }

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return Response.json({ error: "Please sign in." }, { status: 401 });
  }

  const secret = env.AUTH_SECRET || "dev-secret-change-me";
  const payload = await verifyToken(token, secret);
  if (!payload) {
    return Response.json({ error: "Session expired, please sign in again." }, { status: 401 });
  }

  if (!allowedRoles.includes(payload.role)) {
    return Response.json({ error: "Your account doesn't have access to this." }, { status: 403 });
  }

  // Live revocation check — this is what lets an admin force-logout a device
  // immediately instead of waiting for the 12-hour token to expire on its own,
  // and what stops a deactivated login from continuing to work mid-session.
  const current = await env.DB.prepare(
    "SELECT token_version, active FROM users WHERE id = ?"
  ).bind(payload.id).first();

  if (!current || current.active !== 1) {
    return Response.json({ error: "This login has been disabled. Contact an admin." }, { status: 401 });
  }
  if (current.token_version !== payload.tokenVersion) {
    return Response.json({ error: "This session was signed out remotely. Please sign in again." }, { status: 401 });
  }

  data.user = payload;
  return next();
}
