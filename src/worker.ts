import {
  classifyInbound,
  hasOptOutNotice,
  QUIET_DEFAULT,
} from "./compliance.js";
import { VERSION } from "./version.js";

export interface WorkerEnv {
  PACK_NAME?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        pack: env.PACK_NAME ?? "agentic-text",
        version: VERSION,
      });
    }
    // Preview only. The edge entry never sends: it holds no vendor
    // keys, so it checks shape and compliance and stops there.
    if (request.method === "POST" && url.pathname === "/preview") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "body must be JSON" }, 400);
      }
      if (typeof body !== "object" || body === null || !("text" in body)) {
        return json({ error: "body needs a text string" }, 400);
      }
      const { text } = body as { text: unknown };
      if (typeof text !== "string" || text.length === 0) {
        return json({ error: "body needs a text string" }, 400);
      }
      return json({
        dryRun: true,
        chars: text.length,
        inboundKind: classifyInbound(text),
        hasOptOutNotice: hasOptOutNotice(text),
        quietHours: { ...QUIET_DEFAULT },
      });
    }
    return json({ error: "not found" }, 404);
  },
};
