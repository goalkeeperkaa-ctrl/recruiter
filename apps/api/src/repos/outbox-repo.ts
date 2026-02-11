import type { DbClient } from "../lib/db.js";
import { newId } from "../lib/db.js";

export type OutboxEventType = "application_submitted";

export interface OutboxItem {
  id: string;
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: string;
  dedupeKey: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboxRepo {
  enqueueApplicationSubmitted(applicationId: string): Promise<OutboxItem>;
  listPending(limit?: number): Promise<OutboxItem[]>;
  listDue(now: Date, limit?: number): Promise<OutboxItem[]>;
  markSent(id: string): Promise<void>;
  markRetry(id: string, errorMessage: string): Promise<void>;
}

function retryDelaySeconds(attempt: number): number {
  const schedule = [60, 300, 1800, 7200];
  if (attempt <= schedule.length) {
    return schedule[attempt - 1];
  }
  return 7200;
}

function mapRow(row: Record<string, unknown>): OutboxItem {
  return {
    id: String(row.id),
    eventType: row.event_type as OutboxEventType,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as OutboxItem["status"],
    attempts: Number(row.attempts),
    nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    dedupeKey: String(row.dedupe_key),
    lastError: (row.last_error as string | null) ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PgOutboxRepo implements OutboxRepo {
  public constructor(private readonly db: DbClient) {}

  public async enqueueApplicationSubmitted(applicationId: string): Promise<OutboxItem> {
    const now = new Date();
    const dedupeKey = `application_submitted:${applicationId}`;

    const result = await this.db.query(
      `insert into webhook_outbox (
         id, event_type, dedupe_key, payload, status, attempts, next_attempt_at, created_at, updated_at
       ) values ($1, 'application_submitted', $2, $3::jsonb, 'pending', 0, $4, $4, $4)
       on conflict (dedupe_key)
       do update set updated_at = excluded.updated_at
       returning *`,
      [newId(), dedupeKey, JSON.stringify({ application_id: applicationId }), now],
    );

    return mapRow(result.rows[0]);
  }

  public async listPending(limit = 100): Promise<OutboxItem[]> {
    const result = await this.db.query(
      `select *
       from webhook_outbox
       where status = 'pending'
       order by created_at asc
       limit $1`,
      [limit],
    );

    return result.rows.map(mapRow);
  }

  public async listDue(now: Date, limit = 20): Promise<OutboxItem[]> {
    const result = await this.db.query(
      `select *
       from webhook_outbox
       where status = 'pending'
         and next_attempt_at <= $1
       order by next_attempt_at asc
       limit $2`,
      [now, limit],
    );

    return result.rows.map(mapRow);
  }

  public async markSent(id: string): Promise<void> {
    const now = new Date();
    await this.db.query(
      `update webhook_outbox
       set status = 'sent',
           updated_at = $2,
           last_error = null
       where id = $1`,
      [id, now],
    );
  }

  public async markRetry(id: string, errorMessage: string): Promise<void> {
    const current = await this.db.query(
      `select attempts
       from webhook_outbox
       where id = $1
       limit 1`,
      [id],
    );

    if (current.rowCount !== 1) {
      return;
    }

    const attempts = Number(current.rows[0].attempts) + 1;
    const now = new Date();

    if (attempts >= 10) {
      await this.db.query(
        `update webhook_outbox
         set status = 'failed',
             attempts = $2,
             last_error = $3,
             updated_at = $4
         where id = $1`,
        [id, attempts, errorMessage.slice(0, 2000), now],
      );
      return;
    }

    const delaySeconds = retryDelaySeconds(attempts);
    const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);

    await this.db.query(
      `update webhook_outbox
       set attempts = $2,
           next_attempt_at = $3,
           last_error = $4,
           updated_at = $5
       where id = $1`,
      [id, attempts, nextAttemptAt, errorMessage.slice(0, 2000), now],
    );
  }
}
