import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configFromEnv, createRouter, type ModelRouter } from "@ash/llm";

let router: ModelRouter | null = null;
export function getRouter(): ModelRouter {
  return (router ??= createRouter(configFromEnv()));
}

let world: string | null = null;
/** Описание мира из docs/world.md — неизменная часть промпта мастера. */
export function getWorldBible(): string {
  if (world !== null) return world;
  try {
    world = readFileSync(join(process.cwd(), "..", "..", "docs", "world.md"), "utf8");
  } catch {
    world = "";
  }
  return world;
}

/** Ответ в формате Server-Sent Events. */
export function sseStream(run: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await run(send);
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : String(e) });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
