// Shared Tiger Data (TimescaleDB) connection for API routes.
import { Pool } from "pg";

let pool: Pool | null = null;

export function tiger(): Pool | null {
  if (!process.env.TIGER_DATABASE_URL) return null;
  if (!pool) {
    // libpq semantics for sslmode=require: encrypted, like psql/psycopg (node-pg otherwise demands full cert verification)
    const url = new URL(process.env.TIGER_DATABASE_URL);
    url.searchParams.set("uselibpqcompat", "true");
    pool = new Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 5000 });
  }
  return pool;
}
