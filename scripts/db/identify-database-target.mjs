import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not configured");
const connection = await mysql.createConnection(url);
try {
  const [rows] = await connection.query("SELECT DATABASE() AS database_name, CURRENT_USER() AS current_account, @@hostname AS server_hostname, COUNT(*) OVER () AS account_rows FROM users");
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const parsed = new URL(url);
  console.log(JSON.stringify({
    host: parsed.hostname,
    port: parsed.port || "3306",
    database: first?.database_name ?? null,
    currentAccount: first?.current_account ?? null,
    serverHostname: first?.server_hostname ?? null,
    userRows: first?.account_rows ?? 0,
  }));
} finally {
  await connection.end();
}
