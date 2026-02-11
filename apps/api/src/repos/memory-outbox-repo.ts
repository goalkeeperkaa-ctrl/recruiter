import { newId } from "../lib/db.js";
import type { OutboxItem, OutboxRepo } from "./outbox-repo.js";

function retryDelaySeconds(attempt: number): number {
  const schedule = [60, 300, 1800, 7200];
  if (attempt <= schedule.length) {
    return schedule[attempt - 1];
  }
  return 7200;
}

export class MemoryOutboxRepo implements OutboxRepo {
  private readonly items = new Map<string, OutboxItem>();
  private readonly dedupe = new Map<string, string>();

  public async enqueueApplicationSubmitted(applicationId: string): Promise<OutboxItem> {
    const dedupeKey = `application_submitted:${applicationId}`;
    const existingId = this.dedupe.get(dedupeKey);

    if (existingId) {
      return this.items.get(existingId)!;
    }

    const now = new Date().toISOString();
    const item: OutboxItem = {
      id: newId(),
      eventType: "application_submitted",
      payload: { application_id: applicationId },
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      dedupeKey,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(item.id, item);
    this.dedupe.set(dedupeKey, item.id);
    return item;
  }

  public async listPending(limit = 100): Promise<OutboxItem[]> {
    return [...this.items.values()]
      .filter((item) => item.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  public async listDue(now: Date, limit = 20): Promise<OutboxItem[]> {
    return [...this.items.values()]
      .filter((item) => item.status === "pending" && new Date(item.nextAttemptAt).getTime() <= now.getTime())
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, limit);
  }

  public async markSent(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;
    item.status = "sent";
    item.lastError = null;
    item.updatedAt = new Date().toISOString();
  }

  public async markRetry(id: string, errorMessage: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    item.attempts += 1;
    item.lastError = errorMessage.slice(0, 2000);
    item.updatedAt = new Date().toISOString();

    if (item.attempts >= 10) {
      item.status = "failed";
      return;
    }

    const delay = retryDelaySeconds(item.attempts);
    item.nextAttemptAt = new Date(Date.now() + delay * 1000).toISOString();
  }
}
