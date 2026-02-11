import { newId } from "../lib/db.js";
import {
  defaultFlowDefinition,
  defaultScoringRules,
  type FlowDefinition,
  type FlowNode,
  type ScoringRules,
} from "../lib/flow-definition.js";
import { missingRequired, resolveNextNode, resolveOutcome, scoreAnswers, type SavedAnswer } from "../lib/flow-evaluator.js";
import type { JobsRepo } from "./jobs-repo.js";
import type {
  FlowDraft,
  FlowNextResult,
  FlowRunnerRepo,
  FlowSubmitResult,
  MagicLinkInput,
  MagicLinkResult,
  SaveAnswersInput,
  StartFlowInput,
} from "./flow-runner-repo.js";

interface InMemoryApplication {
  id: string;
  tenantId: string;
  tenantSlug: string;
  publicSlug: string;
  jobId: string;
  flowVersionId: string;
  status: string;
  stage: string;
  scoreTotal: number;
  scoreBreakdown: Record<string, number>;
  submittedAt: string | null;
  flow: FlowDefinition;
  scoringRules: ScoringRules;
  answers: SavedAnswer[];
}

interface MagicLinkRecord {
  token: string;
  applicationId: string;
  expiresAt: string;
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

export class MemoryFlowRunnerRepo implements FlowRunnerRepo {
  private readonly applications = new Map<string, InMemoryApplication>();
  private readonly magicLinks = new Map<string, MagicLinkRecord>();

  public constructor(private readonly jobsRepo: JobsRepo) {}

  public async startDraft(tenantSlug: string, publicSlug: string, _input: StartFlowInput): Promise<FlowDraft | null> {
    const job = await this.jobsRepo.findPublic(tenantSlug, publicSlug);
    if (!job || job.status !== "active") {
      return null;
    }

    const flow = defaultFlowDefinition();
    const scoringRules = defaultScoringRules();

    const app: InMemoryApplication = {
      id: newId(),
      tenantId: job.tenantId,
      tenantSlug,
      publicSlug,
      jobId: job.id,
      flowVersionId: "memory-v1",
      status: "new",
      stage: "New",
      scoreTotal: 0,
      scoreBreakdown: {},
      submittedAt: null,
      flow,
      scoringRules,
      answers: [],
    };

    this.applications.set(app.id, app);

    return this.toDraft(app);
  }

  public async saveAnswers(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    input: SaveAnswersInput,
  ): Promise<FlowDraft | null> {
    const app = this.findContextApp(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    const preserved = app.answers.filter((item) => item.nodeKey !== input.nodeKey);
    const incoming: SavedAnswer[] = input.answers.map((answer) => ({
      nodeKey: input.nodeKey,
      questionId: answer.questionId,
      questionText: answer.questionText,
      value: answer.value,
    }));

    app.answers = [...preserved, ...incoming];

    const scored = scoreAnswers(app.flow, app.answers);
    app.scoreTotal = scored.scoreTotal;
    app.scoreBreakdown = scored.scoreBreakdown;

    return this.toDraft(app);
  }

  public async submit(tenantSlug: string, publicSlug: string, applicationId: string): Promise<FlowSubmitResult | null> {
    const app = this.findContextApp(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    if (app.submittedAt) {
      return {
        applicationId: app.id,
        status: app.status,
        stage: app.stage,
        scoreTotal: app.scoreTotal,
        scoreBreakdown: app.scoreBreakdown,
        missingRequired: [],
        submittedAt: app.submittedAt,
        finalizedNow: false,
      };
    }

    const missed = missingRequired(app.flow, app.answers);
    const scored = scoreAnswers(app.flow, app.answers);

    app.scoreTotal = scored.scoreTotal;
    app.scoreBreakdown = scored.scoreBreakdown;

    if (missed.length > 0) {
      return {
        applicationId: app.id,
        status: app.status,
        stage: app.stage,
        scoreTotal: app.scoreTotal,
        scoreBreakdown: app.scoreBreakdown,
        missingRequired: missed,
        submittedAt: null,
        finalizedNow: false,
      };
    }

    const outcome = resolveOutcome(app.scoreTotal, app.scoringRules);
    app.status = outcome.status;
    app.stage = outcome.stage;
    app.submittedAt = new Date().toISOString();

    return {
      applicationId: app.id,
      status: app.status,
      stage: app.stage,
      scoreTotal: app.scoreTotal,
      scoreBreakdown: app.scoreBreakdown,
      missingRequired: [],
      submittedAt: app.submittedAt,
      finalizedNow: true,
    };
  }

  public async nextNode(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    currentNodeKey: string,
  ): Promise<FlowNextResult | null> {
    const app = this.findContextApp(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    const scored = scoreAnswers(app.flow, app.answers);
    app.scoreTotal = scored.scoreTotal;
    app.scoreBreakdown = scored.scoreBreakdown;

    const nextNodeKey = resolveNextNode(app.flow, currentNodeKey, app.answers, app.scoreTotal);
    const progress = nodeProgress(app.flow, currentNodeKey);

    return {
      currentNodeKey,
      currentNode: findNode(app.flow, currentNodeKey),
      nextNodeKey,
      nextNode: findNode(app.flow, nextNodeKey),
      currentStep: progress.currentStep,
      totalSteps: progress.totalSteps,
      scoreTotal: app.scoreTotal,
    };
  }

  public async issueMagicLink(
    tenantSlug: string,
    publicSlug: string,
    applicationId: string,
    input: MagicLinkInput,
  ): Promise<MagicLinkResult | null> {
    const app = this.findContextApp(tenantSlug, publicSlug, applicationId);
    if (!app) {
      return null;
    }

    const token = newId().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000).toISOString();

    this.magicLinks.set(token, {
      token,
      applicationId,
      expiresAt,
    });

    return { token, expiresAt };
  }

  public async resumeByToken(token: string): Promise<FlowDraft | null> {
    const link = this.magicLinks.get(token);
    if (!link) {
      return null;
    }

    if (new Date(link.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    const app = this.applications.get(link.applicationId);
    if (!app) {
      return null;
    }

    return this.toDraft(app);
  }

  private findContextApp(tenantSlug: string, publicSlug: string, applicationId: string): InMemoryApplication | null {
    const app = this.applications.get(applicationId);
    if (!app || app.tenantSlug !== tenantSlug || app.publicSlug !== publicSlug) {
      return null;
    }
    return app;
  }

  private toDraft(app: InMemoryApplication): FlowDraft {
    return {
      applicationId: app.id,
      tenantId: app.tenantId,
      jobId: app.jobId,
      flowVersionId: app.flowVersionId,
      status: app.status,
      stage: app.stage,
      scoreTotal: app.scoreTotal,
      scoreBreakdown: app.scoreBreakdown,
      submittedAt: app.submittedAt,
      flow: app.flow,
      scoringRules: app.scoringRules,
    };
  }
}
