import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

// Non-destructive initial schema for a fresh PostgreSQL database. Existing
// documents and tables are preserved. Version future ALTERs as new migrations.
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(782113407)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS neurotext_workspaces (
        session_id text NOT NULL,
        function_id integer NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (session_id, function_id)
      );
      CREATE TABLE IF NOT EXISTS neurotext_visitors (
        visitor_id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS neurotext_usage (
        session_id text PRIMARY KEY,
        operations_used integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS neurotext_diagnostics (
        id text PRIMARY KEY,
        function_id integer NOT NULL,
        function_name text NOT NULL,
        status text NOT NULL,
        elapsed_ms integer NOT NULL,
        first_word_ms integer NOT NULL,
        word_count integer NOT NULL,
        selected_model text NOT NULL,
        provider text NOT NULL,
        cause text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query("COMMIT");
    logger.info("PostgreSQL schema is ready");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

initializeDatabase()
  .catch((err: unknown) => {
    logger.error({ err }, "Database initialization failed");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
