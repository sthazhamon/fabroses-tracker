// Shared auth helpers: credential hashing (PBKDF2) and session token sign/verify.
// Not a route — files starting with "_" are ignored by Pages Functions routing.
//
// Iteration count is a deliberate tradeoff: Cloudflare Workers' free plan gives
// each request a small CPU-time budget, and PBKDF2 iterations cost CPU. 50,000
// iterations of PBKDF2-SHA256 via native WebCrypto is meaningfully better than
// no hashing at all and comfortably fits the free tier in practice. If you move
// to the $5/month Workers Paid plan (much higher CPU budget), you can safely
// raise PBKDF2_ITERATIONS below for a stronger margin.
const PBKDF2_ITERATIONS = 50000;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufToHex(bytes);
}

export async function hashPin(pin, saltHex) {
  const salt = hexToBuf(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bufToHex(derived);
}

export async function verifyPin(pin, saltHex, expectedHashHex) {
  const actualHashHex = await hashPin(pin, saltHex);
  // Constant-time-ish comparison — not perfectly timing-safe, but avoids the
  // obvious short-circuit-on-first-mismatch string comparison.
  if (actualHashHex.length !== expectedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHashHex.length; i++) {
    diff |= actualHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------- session tokens (separate from credential hashing above) ----------------

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

export async function signToken(payload, secret) {
  const payloadStr = btoa(JSON.stringify(payload));
  const sig = await hmacSign(payloadStr, secret);
  return `${payloadStr}.${sig}`;
}

export async function verifyToken(token, secret) {
  try {
    const [payloadStr, sig] = token.split(".");
    if (!payloadStr || !sig) return null;
    const expectedSig = await hmacSign(payloadStr, secret);
    if (expectedSig !== sig) return null;
    const payload = JSON.parse(atob(payloadStr));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}
