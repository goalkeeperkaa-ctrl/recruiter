import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  parseMagicLinkInput,
  parseSaveAnswersInput,
  parseStartFlowInput,
} from "../repos/flow-runner-repo.js";

export async function registerFlowRunnerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/public/:tenantSlug/jobs/:publicSlug/flow/start", async (request, reply) => {
    try {
      const params = request.params as { tenantSlug: string; publicSlug: string };
      const input = parseStartFlowInput(request.body ?? { candidate: {} });
      const draft = await app.repos.flowRunner.startDraft(params.tenantSlug, params.publicSlug, input);

      if (!draft) {
        return reply.code(404).send({ error: "job_not_found_or_not_active" });
      }

      return reply.code(201).send({
        applicationId: draft.applicationId,
        status: draft.status,
        stage: draft.stage,
        scoreTotal: draft.scoreTotal,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "validation_error", details: error.flatten() });
      }

      return reply.code(500).send({ error: "flow_start_failed" });
    }
  });

  app.post("/public/:tenantSlug/jobs/:publicSlug/flow/:applicationId/save", async (request, reply) => {
    try {
      const params = request.params as {
        tenantSlug: string;
        publicSlug: string;
        applicationId: string;
      };
      const input = parseSaveAnswersInput(request.body);
      const updated = await app.repos.flowRunner.saveAnswers(
        params.tenantSlug,
        params.publicSlug,
        params.applicationId,
        input,
      );

      if (!updated) {
        return reply.code(404).send({ error: "application_not_found" });
      }

      const next = await app.repos.flowRunner.nextNode(
        params.tenantSlug,
        params.publicSlug,
        params.applicationId,
        input.nodeKey,
      );

      return reply.send({
        applicationId: updated.applicationId,
        scoreTotal: updated.scoreTotal,
        scoreBreakdown: updated.scoreBreakdown,
        currentNodeKey: next?.currentNodeKey ?? input.nodeKey,
        currentNode: next?.currentNode ?? null,
        nextNodeKey: next?.nextNodeKey ?? null,
        nextNode: next?.nextNode ?? null,
        currentStep: next?.currentStep ?? 1,
        totalSteps: next?.totalSteps ?? updated.flow.nodes.length,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "validation_error", details: error.flatten() });
      }

      return reply.code(500).send({ error: "flow_save_failed" });
    }
  });

  app.post("/public/:tenantSlug/jobs/:publicSlug/flow/:applicationId/submit", async (request, reply) => {
    const params = request.params as {
      tenantSlug: string;
      publicSlug: string;
      applicationId: string;
    };
    const submitted = await app.repos.flowRunner.submit(params.tenantSlug, params.publicSlug, params.applicationId);

    if (!submitted) {
      return reply.code(404).send({ error: "application_not_found" });
    }

    if (submitted.missingRequired.length > 0) {
      return reply.code(422).send({
        error: "required_fields_missing",
        missingRequired: submitted.missingRequired,
        scoreTotal: submitted.scoreTotal,
      });
    }

    if (submitted.finalizedNow) {
      await app.repos.outbox.enqueueApplicationSubmitted(submitted.applicationId);
    }

    return reply.send(submitted);
  });

  app.get("/public/:tenantSlug/jobs/:publicSlug/flow/:applicationId/next/:nodeKey", async (request, reply) => {
    const params = request.params as {
      tenantSlug: string;
      publicSlug: string;
      applicationId: string;
      nodeKey: string;
    };

    const next = await app.repos.flowRunner.nextNode(
      params.tenantSlug,
      params.publicSlug,
      params.applicationId,
      params.nodeKey,
    );

    if (!next) {
      return reply.code(404).send({ error: "application_not_found" });
    }

    return reply.send(next);
  });

  app.post("/public/:tenantSlug/jobs/:publicSlug/flow/:applicationId/magic-link", async (request, reply) => {
    try {
      const params = request.params as {
        tenantSlug: string;
        publicSlug: string;
        applicationId: string;
      };
      const input = parseMagicLinkInput(request.body);
      const link = await app.repos.flowRunner.issueMagicLink(
        params.tenantSlug,
        params.publicSlug,
        params.applicationId,
        input,
      );

      if (!link) {
        return reply.code(404).send({ error: "application_not_found" });
      }

      return reply.code(201).send(link);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "validation_error", details: error.flatten() });
      }

      return reply.code(500).send({ error: "magic_link_issue_failed" });
    }
  });

  app.get("/public/flow/resume/:token", async (request, reply) => {
    const params = request.params as { token: string };
    const draft = await app.repos.flowRunner.resumeByToken(params.token);

    if (!draft) {
      return reply.code(404).send({ error: "resume_link_not_found_or_expired" });
    }

    return reply.send({
      applicationId: draft.applicationId,
      status: draft.status,
      stage: draft.stage,
      scoreTotal: draft.scoreTotal,
      scoreBreakdown: draft.scoreBreakdown,
      submittedAt: draft.submittedAt,
      flow: draft.flow,
      scoringRules: draft.scoringRules,
    });
  });
}
