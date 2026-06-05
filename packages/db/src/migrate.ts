import path from "node:path";
import dotenv from "dotenv";

import { createDatabasePool } from "./client.js";
import { runMigrations } from "./migrations.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const pool = createDatabasePool();

try {
  const applied = await runMigrations(pool);

  if (applied.length === 0) {
    console.log("No migrations to apply.");
  } else {
    console.log(`Applied migrations: ${applied.join(", ")}`);
  }
} finally {
  await pool.end();
}
