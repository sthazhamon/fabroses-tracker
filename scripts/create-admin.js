#!/usr/bin/env node
// One-time bootstrap: generates the SQL to create the very first admin login.
// After that, all further logins are created through the app's Users tab.
//
// Usage:
//   node scripts/create-admin.js <name> <username> <pin> [role] [reseller_name]
//
// Example:
//   node scripts/create-admin.js "Sherry Thomas" sherry mySecurePin123
//
// This prints a `wrangler d1 execute` command — copy/paste and run it.
// It does NOT touch your database itself; it only computes the hash locally
// (matching the exact algorithm used by the live app) and prints the SQL.

const crypto = require("node:crypto").webcrypto;

const PBKDF2_ITERATIONS = 50000; // must match functions/api/_auth.js

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function generateSalt() {
  return bufToHex(crypto.getRandomValues(new Uint8Array(16)));
}
async function hashPin(pin, saltHex) {
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

async function main() {
  const [name, username, pin, role = "admin", resellerName] = process.argv.slice(2);

  if (!name || !username || !pin) {
    console.error("Usage: node scripts/create-admin.js <name> <username> <pin> [role] [reseller_name]");
    process.exit(1);
  }
  if (pin.length < 6) {
    console.error("PIN must be at least 6 characters.");
    process.exit(1);
  }

  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  const usernameNorm = username.trim().toLowerCase();
  const resellerSql = resellerName ? `'${resellerName.replace(/'/g, "''")}'` : "NULL";

  const sql = `INSERT INTO users (name, username, pin_hash, pin_salt, role, reseller_name, token_version, active) VALUES ('${name.replace(/'/g, "''")}', '${usernameNorm}', '${hash}', '${salt}', '${role}', ${resellerSql}, 1, 1);\n`;

  const fs = require("node:fs");
  const outFile = "create-admin.sql";
  fs.writeFileSync(outFile, sql);

  console.log(`\nWrote the SQL to ./${outFile}\n`);
  console.log("Run this command to create the login:\n");
  console.log(`wrangler d1 execute fabroses-db --remote --file=./${outFile}\n`);
  console.log(`Then sign in with username "${usernameNorm}" and the PIN you chose.`);
  console.log("This script never sent your PIN anywhere — it only computed the hash locally.");
  console.log(`You can delete ${outFile} after running the command above — it contains your PIN's hash, not the PIN itself, but no need to leave it lying around.\n`);
}

main();
