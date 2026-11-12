import { env } from "cloudflare:workers";
import { neon } from "@neondatabase/serverless";

type DatabaseEnvironment = {
  DATABASE_URL?: string;
  DATABASE_HTTP_URL?: string;
  DATABASE_HTTP_TOKEN?: string;
};

export class DatabaseError extends Error {
  constructor(public readonly code?: string) {
    super("Database query failed");
  }
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const config = env as DatabaseEnvironment;
  if (config.DATABASE_HTTP_URL && config.DATABASE_HTTP_TOKEN) {
    const response = await fetch(config.DATABASE_HTTP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.DATABASE_HTTP_TOKEN}`,
      },
      body: JSON.stringify({ query: sql, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as { rows?: T[]; code?: string };
    if (!response.ok || !Array.isArray(data.rows)) throw new DatabaseError(data.code);
    return data.rows;
  }
  if (!config.DATABASE_URL) throw new DatabaseError("NOT_CONFIGURED");
  try {
    return await neon(config.DATABASE_URL).query(sql, params) as T[];
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    throw new DatabaseError(code);
  }
}
