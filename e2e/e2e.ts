/**
 * Dry-run E2E for agentic-text/adapters against local fakes of the
 * Twilio and Telnyx messaging APIs. Nothing real is sent: the fakes run
 * on 127.0.0.1 inside this Bun process and each adapter's baseUrl
 * points at its fake. Modelled on the directory CRM's fake-sms.ts:
 * Twilio queues with a null price and reports it on the Message
 * resource after a terminal status; its callback signature is
 * HMAC-SHA1 over URL + sorted params. Telnyx returns cost on the
 * message and signs webhooks with ed25519 over `timestamp|body`.
 *
 * Run: bun e2e/e2e.ts
 */
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import {
  assertE164,
  TelnyxSmsAdapter,
  telnyxEventPrice,
  twilioCallbackPrice,
  TwilioSmsAdapter,
  VendorError,
  verifyTelnyxSignature,
  verifyTwilioSignature,
} from "../src/adapters.js";

declare const Bun: {
  serve(opts: {
    port: number;
    hostname: string;
    fetch(req: Request): Response | Promise<Response>;
  }): { port: number; stop(): void };
};

const TWILIO_SID = "ACfake00000000000000000000000001";
const TWILIO_TOKEN = "fake_twilio_token";
const TELNYX_KEY = "fake_telnyx_key";

const { publicKey: telnyxPub, privateKey: telnyxPriv } =
  generateKeyPairSync("ed25519");
const telnyxPubB64 = telnyxPub
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("base64");

const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

const twilioLog: { sid: string; statusCallback: string; terminal: boolean }[] =
  [];
const telnyxLog: { id: string; webhookUrl: string }[] = [];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Fake Twilio: POST .../Messages.json, GET .../Messages/{sid}.json
    if (path.includes("/Messages")) {
      const auth = (req.headers.get("authorization") ?? "").replace(
        /^Basic /i,
        "",
      );
      if (auth !== btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)) {
        return json({ message: "unauthorized", code: 20003 }, 401);
      }
      if (req.method === "POST" && /\/Messages\.json$/.test(path)) {
        const form = await req.formData();
        const sid = `SM${twilioLog.length + 1}`;
        twilioLog.push({
          sid,
          statusCallback: String(form.get("StatusCallback") ?? ""),
          terminal: false,
        });
        return json(
          { sid, status: "queued", price: null, price_unit: "USD" },
          201,
        );
      }
      const one = path.match(/\/Messages\/(SM\d+)\.json$/);
      if (req.method === "GET" && one) {
        const message = twilioLog.find((m) => m.sid === one[1]);
        if (!message) return json({ message: "not found" }, 404);
        return json({
          sid: message.sid,
          status: message.terminal ? "delivered" : "queued",
          price: message.terminal ? "-0.00750" : null,
          price_unit: "USD",
        });
      }
      return json({ message: "not found" }, 404);
    }

    // Fake Telnyx: POST /v2/messages, GET /v2/messages/{id}
    if (path.startsWith("/v2/messages")) {
      if (req.headers.get("authorization") !== `Bearer ${TELNYX_KEY}`) {
        return json({ errors: [{ detail: "unauthorized" }] }, 401);
      }
      if (req.method === "POST" && path === "/v2/messages") {
        const body = (await req.json()) as { webhook_url?: string };
        const id = `msg_${telnyxLog.length + 1}`;
        telnyxLog.push({ id, webhookUrl: body.webhook_url ?? "" });
        return json({
          data: {
            id,
            record_type: "message",
            direction: "outbound",
            cost: { amount: "0.0040", currency: "USD" },
          },
        });
      }
      const one = path.match(/^\/v2\/messages\/(msg_\d+)$/);
      if (req.method === "GET" && one) {
        return json({
          data: {
            id: one[1],
            cost: { amount: "0.0040", currency: "USD" },
          },
        });
      }
      return json({ errors: [{ detail: "not found" }] }, 404);
    }

    return json({ error: "not found" }, 404);
  },
});

const base = `http://127.0.0.1:${server.port}`;
let passed = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log(`ok ${name}`);
};

// (a) E.164 only
let threw = false;
try {
  new TwilioSmsAdapter({
    to: "555-1234",
    from: "+15557654321",
    accountSid: TWILIO_SID,
    authToken: TWILIO_TOKEN,
  });
} catch {
  threw = true;
}
check("non-E.164 to refused", threw);
threw = false;
try {
  new TelnyxSmsAdapter({ to: "+15551234567", from: "555", apiKey: TELNYX_KEY });
} catch {
  threw = true;
}
check("non-E.164 from refused", threw);
threw = false;
try {
  assertE164("5551234", "to");
} catch {
  threw = true;
}
check("assertE164 bare digits refused", threw);

// (b)+(c) Twilio send returns the provider id and posts the callback URL
const twilio = new TwilioSmsAdapter({
  to: "+15551234567",
  from: "+15557654321",
  accountSid: TWILIO_SID,
  authToken: TWILIO_TOKEN,
  statusCallback: "https://crm.example/hooks/twilio",
  baseUrl: base,
});
const sent = await twilio.dispatch("hello there");
check("twilio provider id", sent.id === "SM1");
check(
  "twilio status callback sent",
  twilioLog[0].statusCallback === "https://crm.example/hooks/twilio",
);
check("queued send reports no price", sent.costCents === undefined);

// (e) price in integer cents from the callback params / message fetch
const cb = twilioCallbackPrice({
  MessageSid: "SM1",
  MessageStatus: "delivered",
  Price: "-0.00750",
  PriceUnit: "USD",
});
check("twilio callback price", cb.costCents === 1 && cb.currency === "USD");
const charge = await twilio.charge("SM1");
check("twilio queued charge still empty", charge.costCents === undefined);
twilioLog[0].terminal = true;
const final = await twilio.charge("SM1");
check("twilio final charge", final.costCents === 1 && final.currency === "USD");

// (d) Twilio HMAC-SHA1 signature verification
const cbUrl = "https://crm.example/hooks/twilio";
const params: Record<string, string> = {
  MessageSid: "SM1",
  MessageStatus: "delivered",
  AccountSid: TWILIO_SID,
  Price: "-0.00750",
  PriceUnit: "USD",
};
const signedData = Object.keys(params)
  .sort()
  .reduce((acc, k) => acc + k + params[k], cbUrl);
const sig = createHmac("sha1", TWILIO_TOKEN)
  .update(signedData)
  .digest("base64");
check(
  "twilio good signature verifies",
  (await verifyTwilioSignature({
    authToken: TWILIO_TOKEN,
    url: cbUrl,
    params,
    signature: sig,
  })) === true,
);
check(
  "twilio bad signature refused",
  (await verifyTwilioSignature({
    authToken: TWILIO_TOKEN,
    url: cbUrl,
    params,
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  })) === false,
);
check(
  "twilio tampered params refused",
  (await verifyTwilioSignature({
    authToken: TWILIO_TOKEN,
    url: cbUrl,
    params: { ...params, MessageStatus: "failed" },
    signature: sig,
  })) === false,
);

// (b)+(c) Telnyx send returns the provider id and posts webhook_url
const telnyx = new TelnyxSmsAdapter({
  to: "+15551234567",
  from: "+15557654321",
  apiKey: TELNYX_KEY,
  messagingProfileId: "mp_fake",
  webhookUrl: "https://crm.example/hooks/telnyx",
  baseUrl: base,
});
const tsent = await telnyx.dispatch("hi telnyx");
check("telnyx provider id", tsent.id === "msg_1");
check(
  "telnyx webhook url sent",
  telnyxLog[0].webhookUrl === "https://crm.example/hooks/telnyx",
);
check("telnyx send cost", tsent.costCents === 0 && tsent.currency === "USD");
const tcharge = await telnyx.charge("msg_1");
check("telnyx charge", tcharge.costCents === 0 && tcharge.currency === "USD");

// (e) Telnyx webhook payload cost -> cents
const webhook = {
  data: {
    event_type: "message.finalized",
    id: "evt_1",
    payload: {
      id: "msg_1",
      cost: { amount: "0.0040", currency: "USD" },
    },
  },
};
const eprice = telnyxEventPrice(webhook);
check("telnyx webhook price", eprice.costCents === 0 && eprice.currency === "USD");

// (d) Telnyx ed25519 signature verification
const ts = "1729555200";
const rawBody = JSON.stringify(webhook);
const tsig = sign(null, Buffer.from(`${ts}|${rawBody}`), telnyxPriv).toString(
  "base64",
);
check(
  "telnyx good signature verifies",
  (await verifyTelnyxSignature({
    publicKey: telnyxPubB64,
    timestamp: ts,
    signature: tsig,
    payload: rawBody,
  })) === true,
);
check(
  "telnyx bad signature refused",
  (await verifyTelnyxSignature({
    publicKey: telnyxPubB64,
    timestamp: ts,
    signature: Buffer.alloc(64).toString("base64"),
    payload: rawBody,
  })) === false,
);
check(
  "telnyx tampered payload refused",
  (await verifyTelnyxSignature({
    publicKey: telnyxPubB64,
    timestamp: ts,
    signature: tsig,
    payload: rawBody.replace("msg_1", "msg_9"),
  })) === false,
);

// error paths stay VendorError
let err: unknown;
try {
  await new TwilioSmsAdapter({
    to: "+15551234567",
    from: "+15557654321",
    accountSid: "ACwrong",
    authToken: "wrong",
    baseUrl: base,
  }).dispatch("x");
} catch (error) {
  err = error;
}
check("twilio 401 is VendorError", err instanceof VendorError);

server.stop();
console.log(`PASS ${passed} checks`);
