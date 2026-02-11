import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  JWT_SECRET: z.string().min(8).default("dev-secret-change-me"),
  DATABASE_URL: z.string().url().optional(),
  WEBHOOK_TARGET_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(8).default("dev-webhook-secret"),
  CRON_DISPATCH_SECRET: z.string().min(8).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(input: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(input);
}
