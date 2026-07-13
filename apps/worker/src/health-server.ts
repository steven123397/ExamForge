import { createServer, type Server, type ServerResponse } from "node:http";

export interface ReadinessChecks {
  checkPostgres(): Promise<void>;
  checkRedis(): Promise<void>;
}

export interface HealthServerOptions {
  host: string;
  port: number;
  service: string;
}

export interface HealthServer {
  readonly url: string;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createHealthServer(
  checks: ReadinessChecks,
  options: HealthServerOptions,
): HealthServer {
  let server: Server | null = null;
  let url = "";
  return {
    get url() {
      if (!url) {
        throw new Error("Health server has not started.");
      }
      return url;
    },
    async start() {
      if (server) {
        return;
      }
      server = createServer(async (request, response) => {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        if (request.url === "/health") {
          sendJson(response, 200, { ok: true, service: options.service });
          return;
        }
        if (request.url === "/ready") {
          try {
            await Promise.all([
              checks.checkPostgres(),
              checks.checkRedis(),
            ]);
            sendJson(response, 200, { ok: true, service: options.service });
          } catch {
            sendJson(response, 503, {
              ok: false,
              service: options.service,
              error: "dependency_unavailable",
            });
          }
          return;
        }
        sendJson(response, 404, { error: "not_found" });
      });
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(options.port, options.host, () => {
          server?.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Health server did not expose a TCP address.");
      }
      url = `http://${options.host}:${address.port}`;
    },
    async close() {
      if (!server) {
        return;
      }
      const active = server;
      server = null;
      url = "";
      await new Promise<void>((resolve, reject) => {
        active.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
