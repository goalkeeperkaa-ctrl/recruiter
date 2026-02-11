export type EventType =
  | "application_submitted"
  | "score_updated"
  | "stage_changed"
  | "interview_scheduled"
  | "interview_rescheduled"
  | "message_failed";

export interface WebhookEnvelope<TData = unknown> {
  event_id: string;
  event_type: EventType;
  tenant_id: string;
  occurred_at: string;
  data: TData;
}
