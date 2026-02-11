import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { DbClient } from "../lib/db.js";
import { newId } from "../lib/db.js";
import {
  defaultFlowDefinition,
  defaultScoringRules,
  type FlowDefinition,
  type FlowNode,
  type ScoringRules,
} from "../lib/flow-definition.js";
import {
  missingRequired,
  resolveNextNode,
  resolveOutcome,
  scoreAnswers,
  type SavedAnswer,
} from "../lib/flow-evaluator.js";

const startSchema = z.object({
  candidate: z.object({
    fullName: z.string().min(2).optional(),
    phoneE164: z.string().min(6).optional(),
    email: z.string().email().optional(),
  }),
});

const saveSchema = z.object({
  nodeKey: z.string().min(1),
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      questionText: z.string().min(1),
      value: z.unknown(),
    }),
  ),
});

const magicLinkSchema = z.object({
  ttlDays: z.number().int().min(7).max(30).default(7),
});

export type StartFlowInput = z.infer<typeof startSchema>;
export type SaveAnswersInput = z.infer<typeof saveSchema>;
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;

export function parseStartFlowInput(input: unknown): StartFlowInput {
  return startSchema.parse(input);
}

export function parseSaveAnswersInput(input: unknown): SaveAnswersInput {
  return saveSchema.parse(input);
}

export function parseMagicLinkInput(input: unknown): MagicLinkInput {
  return magicLinkSchema.parse(input ?? {});
}

export interface FlowDraft {
  applicationId: string;
  tenantId: string;
  jobId: string;
  flowVersionId: string;
  status: string;
  stage: string;
  scoreTotal: number;
  scoreBreakdown: Record<string, number>;
  submittedAt: string | null;
  flow: FlowDefinition;
  scoringRules: ScoringRules;
}

export interface FlowSubmitResult {
  applicationId: string;
  status: string;
  stage: string;
  scoreTotal: number;
  scoreBreakdown: Record<string, number>;
  missingRequired: string[];
  submittedAt: string | null;
  finalizedNow: boolean;
}

export interface FlowNextResult {
  currentNodeKey: string;
  currentNode: FlowNode | null;
  nextNodeKey: string | null;
  nextNode: FlowNode | null;
  currentStep: number;
  totalSteps: number;
  scoreTotal: number;
}

export interface MagicLinkResult {
  token: string;
  expiresAt: string;
}

export interface FlowRunnerRepo {
  startDraft(tenantSlug: string, publicSlug: string, input: StartFlowInput): Promise<FlowDraft | null>;
  saveAnswers(tenantSlug: string, publicSlug: string, applicationId: string, input: SaveAnswersInput): Promise<FlowDraft | null>;
  submit(tenantSlug: string, publicSlug: string, applicationId: string): Promise<FlowSubmitResult | null>;
  nextNode(tenantSlug: string, publicSlug: string, applicationId: string, currentNodeKey: string): Promise<FlowNextResult | null>;
  issueMagicLink(tenantSlug: string, publicSlug: string, applicationId: string, input: MagicLinkInput): Promise<MagicLinkResult | null>;
  resumeByToken(token: string): Promise<FlowDraft | null>;
}

function toSavedAnswers(rows: Array<Record<string, unknown>>): SavedAnswer[] {
  return rows.map((row) => {
    const answer = row.answer as { questionId: string; value: unknown };
    return {
      nodeKey: String(row.node_key),
      questionId: String(answer.questionId),
      questionText: String(row.question_text_snapshot),
      value: answer.value,
    };
  });
}

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

interface AppRow {
  id: string;
  tenant_id: string;
  job_id: string;
  flow_version_id: string;
  status: string;
  stage: string;
  score_total: number;
  score_breakdown: Record<string, number>;
  submitted_at: Date | null;
  definition: FlowDefinition | null;
  scoring_rules: ScoringRules | null;
}

function toDraft(row: AppRow): FlowDraft {
  return {
    applicationId: String(row.id),
    tenantId: String(row.tenant_id),
    jobId: String(row.job_id),
    flowVersionId: String(row.flow_version_id),
    status: String(row.status),
    stage: String(row.stage),
    scoreTotal: Number(row.score_total),
    scoreBreakdown: row.score_breakdown ?? {},
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    flow: row.definition ?? defaultFlowDefinition(),
    scoringRules: row.scoring_rules ?? defaultScoringRules(),
  };
}

function findNode(flow: FlowDefinition, nodeKey: string | null): FlowNode | null {
  if (!nodeKey) {
    return null;
  }
  return flow.nodes.find((node) => node.key === nodeKey) ?? null;
}

function nodeProgress(flow: FlowDefinition, nodeKey: string): { currentStep: number; totalSteps: number } {
  const totalSteps = flow.nodes.length;
  const idx = flow.nodes.findIndex((node) => node.key === nodeKey);
  return {
    currentStep: idx >= 0 ? idx + 1 : 1,
    totalSteps,
  };
}

export class PgFlowRunnerRepo implements FlowRunnerRepo {
  public constructor(private readonly db: DbClient) {}

  public async startDraft(tenantSlug: string, publicSlug: string, input: StartFlowInput): Promise<FlowDraft | null> {
    const jobRes = await this.db.query(
      `select
         j.id,
         j.tenant_id,
         j.active_flow_version_id,
         fv.definition,
         fv.scoring_rules
       from jobs j
       join tenants t on t.id = j.tenant_id
       left join flow_versions fv on fv.id = j.active_flow_version_id
       where t.slug = $1
         and j.public_slug = $2
         and j.status = 'active'
       limit 1`,
      [tenantSlug, publicSlug],
    );

    if (jobRes.rowCount !== 1) {
      return null;
    }

    const job = jobRes.rows[0];
    if (!job.active_flow_version_id) {
      return null;
    }

    const now = new Date();
    const candidateId = newId();
    const applicationId = newId();

    await this.db.query(
      `insert into candidates (id, tenant_id, full_name, phone_e164, email, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [
        candidateId,
        job.tenant_id,
        input.candidate.fullName ?? null,
        input.candidate.phoneE164 ?? null,
        input.candidate.email?.toLowerCase() ?? null,
        now,
      ],
    );

    await this.db.query(
      `insert into applications (
         id, tenant_id, candidate_id, job_id, flow_version_id, status, stage, score_total, score_breakdown, utm, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 'new', 'New', 0, '{}'::jsonb, '{}'::jsonb, $6, $6)`,
      [applicationId, job.tenant_id, candidateId, job.id, job.active_flow_version_id, now],
    );

    return {
      applicationId,
      tenantId: String(job.tenant_id),
      jobId: String(job.id),
      flowVersionId: String(job.active_flow_version_id),
      status: "new",
      stage: "New",
      scoreTotal: 0,
      scoreBreakdown: {},
      submittedAt: null,
      flow: (job.definition as FlowDefinition) ?? defaultFlowDefinition(),
      scoringRules: (job.scoring_rules as ScoringRules) ?? defaultScoringRules(),
    };
  }

  public async saveAnswers(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    input: SaveAnswersInput,
  ): Promise<FlowDraft | null> {
    const app = await this.findByJobContext(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    await this.db.query(
      `delete from application_answers
       where application_id = $1
         and node_key = $2`,
      [applicationId, input.nodeKey],
    );

    const now = new Date();

    for (const answer of input.answers) {
      await this.db.query(
        `insert into application_answers (
           id, tenant_id, application_id, node_key, question_text_snapshot, answer, score, answered_at
         ) values ($1, $2, $3, $4, $5, $6::jsonb, 0, $7)`,
        [
          newId(),
          app.tenant_id,
          applicationId,
          input.nodeKey,
          answer.questionText,
          JSON.stringify({ questionId: answer.questionId, value: answer.value }),
          now,
        ],
      );
    }

    const saved = await this.listSavedAnswers(applicationId);
    const flow = (app.definition as FlowDefinition) ?? defaultFlowDefinition();
    const scored = scoreAnswers(flow, saved);

    await this.db.query(
      `update applications
       set score_total = $2,
           score_breakdown = $3::jsonb,
           updated_at = $4
       where id = $1`,
      [applicationId, scored.scoreTotal, JSON.stringify(scored.scoreBreakdown), new Date()],
    );

    const refreshed = await this.findByJobContext(tenantSlug, publicSlug, applicationId);
    if (!refreshed) {
      return null;
    }

    return toDraft(refreshed);
  }

  public async submit(tenantSlug: string, publicSlug: string, applicationId: string): Promise<FlowSubmitResult | null> {
    const app = await this.findByJobContext(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    if (app.submitted_at) {
      return {
        applicationId,
        status: String(app.status),
        stage: String(app.stage),
        scoreTotal: Number(app.score_total),
        scoreBreakdown: app.score_breakdown ?? {},
        missingRequired: [],
        submittedAt: new Date(app.submitted_at).toISOString(),
        finalizedNow: false,
      };
    }

    const saved = await this.listSavedAnswers(applicationId);

    const flow = (app.definition as FlowDefinition) ?? defaultFlowDefinition();
    const scoringRules = (app.scoring_rules as ScoringRules) ?? defaultScoringRules();
    const missed = missingRequired(flow, saved);
    const scored = scoreAnswers(flow, saved);

    if (missed.length > 0) {
      return {
        applicationId,
        status: String(app.status),
        stage: String(app.stage),
        scoreTotal: scored.scoreTotal,
        scoreBreakdown: scored.scoreBreakdown,
        missingRequired: missed,
        submittedAt: null,
        finalizedNow: false,
      };
    }

    const outcome = resolveOutcome(scored.scoreTotal, scoringRules);
    const submittedAt = new Date();

    await this.db.query(
      `update applications
       set status = $2,
           stage = $3,
           score_total = $4,
           score_breakdown = $5::jsonb,
           submitted_at = $6,
           updated_at = $6
       where id = $1`,
      [applicationId, outcome.status, outcome.stage, scored.scoreTotal, JSON.stringify(scored.scoreBreakdown), submittedAt],
    );

    return {
      applicationId,
      status: outcome.status,
      stage: outcome.stage,
      scoreTotal: scored.scoreTotal,
      scoreBreakdown: scored.scoreBreakdown,
      missingRequired: [],
      submittedAt: submittedAt.toISOString(),
      finalizedNow: true,
    };
  }

  public async nextNode(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    currentNodeKey: string,
  ): Promise<FlowNextResult | null> {
    const app = await this.findByJobContext(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    const saved = await this.listSavedAnswers(applicationId);
    const flow = (app.definition as FlowDefinition) ?? defaultFlowDefinition();
    const scored = scoreAnswers(flow, saved);
    const nextNodeKey = resolveNextNode(flow, currentNodeKey, saved, scored.scoreTotal);
    const progress = nodeProgress(flow, currentNodeKey);

    return {
      currentNodeKey,
      currentNode: findNode(flow, currentNodeKey),
      nextNodeKey,
      nextNode: findNode(flow, nextNodeKey),
      currentStep: progress.currentStep,
      totalSteps: progress.totalSteps,
      scoreTotal: scored.scoreTotal,
    };
  }

  public async issueMagicLink(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    input: MagicLinkInput,
  ): Promise<MagicLinkResult | null> {
    const app = await this.findByJobContext(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);

    await this.db.query(
      `insert into flow_magic_links (token, application_id, expires_at, created_at)
       values ($1, $2, $3, $4)`,
      [token, applicationId, expiresAt, new Date()],
    );

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async resumeByToken(token: string): Promise<FlowDraft | null> {
    const result = await this.db.query(
      `select
         a.id,
         a.tenant_id,
         a.job_id,
         a.flow_version_id,
         a.status,
         a.stage,
         a.score_total,
         a.score_breakdown,
         a.submitted_at,
         fv.definition,
         fv.scoring_rules
       from flow_magic_links ml
       join applications a on a.id = ml.application_id
       join flow_versions fv on fv.id = a.flow_version_id
       where ml.token = $1
         and ml.expires_at > now()
       limit 1`,
      [token],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    return toDraft(result.rows[0] as AppRow);
  }

  private async listSavedAnswers(applicationId: string): Promise<SavedAnswer[]> {
    const result = await this.db.query(
      `select node_key, question_text_snapshot, answer
       from application_answers
       where application_id = $1`,
      [applicationId],
    );

    return toSavedAnswers(result.rows);
  }

  private async findByJobContext(tenantSlug: string, publicSlug: string, applicationId: string): Promise<AppRow | null> {
    const result = await this.db.query(
      `select
         a.id,
         a.tenant_id,
         a.job_id,
         a.flow_version_id,
         a.status,
         a.stage,
         a.score_total,
         a.score_breakdown,
         a.submitted_at,
         fv.definition,
         fv.scoring_rules
       from applications a
       join jobs j on j.id = a.job_id
       join tenants t on t.id = j.tenant_id
       join flow_versions fv on fv.id = a.flow_version_id
       where a.id = $1
         and t.slug = $2
         and j.public_slug = $3
       limit 1`,
      [applicationId, tenantSlug, publicSlug],
    );

    if (result.rowCount !== 1) {
      return null;
    }

    return result.rows[0] as AppRow;
  }
}
