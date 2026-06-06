import pg from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/analytiq";
const pool = new pg.Pool({ connectionString });

try {
  const result = await pool.query("SELECT id, name, token::TEXT AS token, domain_whitelist FROM tenants");
  console.log("Tenants found:", JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error("Database query failed:", error.message);
} finally {
  await pool.end();
}
