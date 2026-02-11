import type { AuthContext } from "./auth.js";
import type { AuthRepo } from "../repos/auth-repo.js";
import type { JobsRepo } from "../repos/jobs-repo.js";
import type { FlowRunnerRepo } from "../repos/flow-runner-repo.js";
import type { OutboxRepo } from "../repos/outbox-repo.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }

  interface FastifyInstance {
    repos: {
      auth: AuthRepo;
      jobs: JobsRepo;
      flowRunner: FlowRunnerRepo;
      outbox: OutboxRepo;
    };
  }
}
