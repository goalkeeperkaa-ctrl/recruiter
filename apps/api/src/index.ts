import dotenv from "dotenv";
import { getEnv } from "./lib/env.js";
import { buildApp } from "./server.js";

dotenv.config();

const env = getEnv(process.env);
const app = await buildApp({ env });

await app.listen({
  host: "0.0.0.0",
  port: env.PORT,
});
