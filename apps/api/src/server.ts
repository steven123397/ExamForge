import { createApp } from "./app.js";
import { validateApiProductionEnvironment } from "./production-config.js";

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number(process.env.API_PORT ?? 4000);
validateApiProductionEnvironment();
const app = createApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
