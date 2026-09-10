import crypto from "node:crypto";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");
const connection = await mysql.createConnection(url);
try {
  const [rows] = await connection.query("SELECT id, email, loginMethod, role, emailVerified, passwordHash, googleId FROM users ORDER BY id");
  const users = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    emailHash: crypto.createHash("sha256").update(String(row.email).trim().toLowerCase()).digest("hex"),
    loginMethod: row.loginMethod,
    role: row.role,
    emailVerified: row.emailVerified,
    hasPassword: Boolean(row.passwordHash),
    hasGoogleId: Boolean(row.googleId),
  }));
  console.log(JSON.stringify({ count: users.length, users }));
} finally {
  await connection.end();
}
