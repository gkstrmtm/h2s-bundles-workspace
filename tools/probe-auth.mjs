// tools/probe-auth.mjs
// Deterministic auth probe: portal_login -> portal_me (same token), no guessing.

const API_BASE = process.env.API_BASE || "https://h2s-backend.vercel.app/api";
const LOGIN_URL = `${API_BASE}/portal_login`;
const ME_URL    = `${API_BASE}/portal_me`;

const email = process.env.PROBE_EMAIL || "h2sbackend@gmail.com";
const zip   = process.env.PROBE_ZIP   || "29649";

function b64urlToJson(part) {
  // Decode JWT payload only for inspection (no verification).
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const txt = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(txt);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, text, json, headers: Object.fromEntries(res.headers.entries()) };
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, text, json, headers: Object.fromEntries(res.headers.entries()) };
}

(async () => {
  console.log("\n=== PROBE: portal_login ===");
  const login = await postJson(LOGIN_URL, { email, zip });
  console.log("STATUS:", login.status);
  console.log("BODY:", login.json ?? login.text);

  const token = login?.json?.token;
  if (!token) {
    console.error("\nFAIL: portal_login did not return a token. Stop and fix portal_login.");
    process.exit(1);
  }

  console.log("\n=== TOKEN PAYLOAD (DECODE ONLY) ===");
  const parts = token.split(".");
  if (parts.length !== 3) {
    console.error("FAIL: token is not a JWT shape.");
    process.exit(1);
  }
  const payload = b64urlToJson(parts[1]);
  console.log(payload);

  console.log("\n=== PROBE: portal_me via query param ===");
  const meQuery = await getJson(`${ME_URL}?token=${encodeURIComponent(token)}`);
  console.log("STATUS:", meQuery.status);
  console.log("BODY:", meQuery.json ?? meQuery.text);

  console.log("\n=== PROBE: portal_me via Authorization header ===");
  const meAuth = await getJson(ME_URL, { authorization: `Bearer ${token}` });
  console.log("STATUS:", meAuth.status);
  console.log("BODY:", meAuth.json ?? meAuth.text);

  console.log("\n=== RESULT SUMMARY ===");
  console.log({
    login_status: login.status,
    me_query_status: meQuery.status,
    me_auth_status: meAuth.status,
    role: payload.role,
    email: payload.email,
    pro_id: payload.pro_id ?? payload.proId ?? payload.pro ?? payload.sub,
  });

  process.exit(0);
})().catch((err) => {
  console.error("PROBE CRASH:", err);
  process.exit(1);
});
