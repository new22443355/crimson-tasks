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

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool().query(sql, params);
    return result.rows as T[];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    throw new DatabaseError(code);
  }
}
