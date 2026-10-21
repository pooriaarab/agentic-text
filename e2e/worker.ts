import {
  TelnyxSmsAdapter,
  telnyxEventPrice,
  TwilioSmsAdapter,
  twilioCallbackPrice,
  verifyTelnyxSignature,
  verifyTwilioSignature,
} from "../src/adapters.js";

// Bundling proof for the /adapters entry point: this worker imports
// only the fetch-only subpath surface, so `wrangler deploy --dry-run`
// shows it packs for Cloudflare Workers. Keys arrive as env arguments
// to the caller, never read inside the package.

export interface WorkerEnv {
  TELNYX_API_KEY?: string;
  TELNYX_API_BASE?: string;
  TELNYX_PUBLIC_KEY?: string;
  TELNYX_WEBHOOK_URL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_BASE?: string;
  TWILIO_STATUS_CALLBACK?: string;
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
      return json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/send/telnyx") {
      if (!env.TELNYX_API_KEY) return json({ error: "no TELNYX_API_KEY" }, 503);
      const body = (await request.json().catch(() => null)) as {
        to?: string;
        from?: string;
        text?: string;
      } | null;
      if (!body?.to || !body.from || !body.text) {
        return json({ error: "need to, from, text" }, 400);
      }
      const adapter = new TelnyxSmsAdapter({
        to: body.to,
        from: body.from,
        apiKey: env.TELNYX_API_KEY,
        webhookUrl: env.TELNYX_WEBHOOK_URL,
        baseUrl: env.TELNYX_API_BASE,
      });
      return json(await adapter.dispatch(body.text));
    }
    if (request.method === "POST" && url.pathname === "/send/twilio") {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
        return json({ error: "no twilio keys" }, 503);
      }
      const body = (await request.json().catch(() => null)) as {
        to?: string;
        from?: string;
        text?: string;
      } | null;
      if (!body?.to || !body.from || !body.text) {
        return json({ error: "need to, from, text" }, 400);
      }
      const adapter = new TwilioSmsAdapter({
        to: body.to,
        from: body.from,
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        statusCallback: env.TWILIO_STATUS_CALLBACK,
        baseUrl: env.TWILIO_API_BASE,
      });
      return json(await adapter.dispatch(body.text));
    }
    if (request.method === "POST" && url.pathname === "/hooks/twilio") {
      const params = new URLSearchParams(await request.text());
      const ok = await verifyTwilioSignature({
        authToken: env.TWILIO_AUTH_TOKEN ?? "",
        url: url.origin + url.pathname,
        params,
        signature: request.headers.get("x-twilio-signature"),
      });
      return json({ ok, price: twilioCallbackPrice(params) });
    }
    if (request.method === "POST" && url.pathname === "/hooks/telnyx") {
      const raw = await request.text();
      const ok = await verifyTelnyxSignature({
        publicKey: env.TELNYX_PUBLIC_KEY ?? "",
        timestamp: request.headers.get("telnyx-timestamp") ?? "",
        signature: request.headers.get("telnyx-signature-ed25519"),
        payload: raw,
      });
      return json({ ok, price: telnyxEventPrice(JSON.parse(raw)) });
    }
    return json({ error: "not found" }, 404);
  },
};
