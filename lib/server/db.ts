import pg from "pg";

const databaseGlobal = globalThis as typeof globalThis & { taskPool?: pg.Pool };

function pool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new DatabaseError("NOT_CONFIGURED");
  if (!databaseGlobal.taskPool) {
    databaseGlobal.taskPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    databaseGlobal.taskPool.on("error", () => console.error("Idle PostgreSQL connection failed"));
  }
  return databaseGlobal.taskPool;
}

export class DatabaseError extends Error {
  constructor(public readonly code?: string) {
    super("Database query failed");
  }
}

function databaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
  return new DatabaseError(code);
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool().query(sql, params);
    return result.rows as T[];
  } catch (error) {
    throw databaseError(error);
  }
}

export async function transaction<T>(run: (execute: typeof query) => Promise<T>): Promise<T> {
  const client = await pool().connect().catch((error: unknown) => { throw databaseError(error); });
  let discard = false;
  const transactionQuery: typeof query = async <Row>(sql: string, params: unknown[] = []): Promise<Row[]> => {
    try {
      const result = await client.query(sql, params);
      return result.rows as Row[];
    } catch (error) { throw databaseError(error); }
  };
  try {
    await transactionQuery("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await run(transactionQuery);
    await transactionQuery("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}
