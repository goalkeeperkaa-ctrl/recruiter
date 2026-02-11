import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export type DbClient = Pool;

export function createDbPool(databaseUrl: string): DbClient {
  return new Pool({
    connectionString: databaseUrl,
  });
}

export function newId(): string {
  return randomUUID();
}
