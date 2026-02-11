import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import type { AppEnv } from "./lib/env.js";
import { getEnv } from "./lib/env.js";
import { createDbPool } from "./lib/db.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerFlowRunnerRoutes } from "./routes/flow-runner.js";
import { registerOutboxRoutes } from "./routes/outbox.js";
import { PgAuthRepo } from "./repos/auth-repo.js";
import { PgJobsRepo } from "./repos/jobs-repo.js";
import { PgFlowRunnerRepo } from "./repos/flow-runner-repo.js";
import { PgOutboxRepo } from "./repos/outbox-repo.js";
import { MemoryAuthRepo, MemoryJobsRepo } from "./repos/memory-repos.js";
import { MemoryFlowRunnerRepo } from "./repos/memory-flow-runner-repo.js";
import { MemoryOutboxRepo } from "./repos/memory-outbox-repo.js";
import type { AuthRepo } from "./repos/auth-repo.js";
import type { JobsRepo } from "./repos/jobs-repo.js";
import type { FlowRunnerRepo } from "./repos/flow-runner-repo.js";
import type { OutboxRepo } from "./repos/outbox-repo.js";

interface AppDependencies {
  env?: AppEnv;
  repos?: {
    auth: AuthRepo;
    jobs: JobsRepo;
    flowRunner: FlowRunnerRepo;
    outbox: OutboxRepo;
  };
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const env = deps.env ?? getEnv(process.env);

  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(helmet);
  await app.register(jwt, { secret: env.JWT_SECRET });

  const repos = deps.repos ?? (() => {
    if (env.DATABASE_URL) {
      const db = createDbPool(env.DATABASE_URL);
      return {
        auth: new PgAuthRepo(db),
        jobs: new PgJobsRepo(db),
        flowRunner: new PgFlowRunnerRepo(db),
        outbox: new PgOutboxRepo(db),
      };
    }

    app.log.warn("DATABASE_URL is not set; using in-memory repositories.");
    const jobs = new MemoryJobsRepo();

    return {
      auth: new MemoryAuthRepo(),
      jobs,
      flowRunner: new MemoryFlowRunnerRepo(jobs),
      outbox: new MemoryOutboxRepo(),
    };
  })();

  app.decorate("repos", repos);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerJobsRoutes(app);
  await registerFlowRunnerRoutes(app);
  await registerOutboxRoutes(app, {
    webhookTargetUrl: env.WEBHOOK_TARGET_URL,
    webhookSecret: env.WEBHOOK_SECRET,
    cronDispatchSecret: env.CRON_DISPATCH_SECRET,
  });

  return app;
}
