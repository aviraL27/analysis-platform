import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET;

if (!secret) {
  console.error("SUPABASE_JWT_SECRET is required");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const expiresIn = Number.parseInt(process.env.JWT_EXPIRES_IN ?? "86400", 10);
const subject = process.env.JWT_SUB ?? randomUUID();
const email = process.env.JWT_EMAIL;

const header = {
  alg: "HS256",
  typ: "JWT"
};

const payload = {
  aud: "authenticated",
  sub: subject,
  iat: now,
  exp: now + expiresIn,
  role: "authenticated",
  ...(email ? { email } : {}),
  ...(process.env.SUPABASE_URL ? { iss: `${process.env.SUPABASE_URL}/auth/v1` } : {})
};

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const encodedHeader = base64UrlEncode(JSON.stringify(header));
const encodedPayload = base64UrlEncode(JSON.stringify(payload));
const signature = createHmac("sha256", secret)
  .update(`${encodedHeader}.${encodedPayload}`)
  .digest("base64")
  .replace(/=+$/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const token = `${encodedHeader}.${encodedPayload}.${signature}`;

console.log(JSON.stringify({ token, sub: subject, email }, null, 2));
