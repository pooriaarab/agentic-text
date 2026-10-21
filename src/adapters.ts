import { twilioAdvice } from "./compliance.js";

// Fetch-only entry point for Cloudflare Workers and other hosts with
// no filesystem and no process.env. `import { TelnyxSmsAdapter } from
// "agentic-text/adapters"` takes every credential as an argument;
// nothing is read from the environment. The SDK, CLI, and MCP entry
// points keep their env fallbacks in ./vendors.js. Nothing here imports
// agentic-core, whose entry pulls node:crypto and node:module.

// AdapterError mirrors the agentic-core VendorError shape
// (`code: "VENDOR_FAILED"`, optional `status`) but is defined on this
// path so the bundle needs no dependency and no nodejs_compat flag.
export class AdapterError extends Error {
  readonly code = "VENDOR_FAILED" as const;
  readonly status?: number;
  constructor(
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdapterError";
    this.status = options.status;
  }
}

// The receipt and adapter shapes match agentic-core's DispatchReceipt
// and RouterAdapter, declared locally for the same reason.
export interface DispatchReceipt {
  adapter: string;
  id: string;
  chars: number;
  at: string;
}

export interface RouterAdapter {
  readonly name: string;
  dispatch(text: string): Promise<DispatchReceipt>;
}

export type SmsVendor = "twilio" | "telnyx" | "plivo";

const E164 = /^\+[1-9]\d{7,14}$/;

export function assertE164(value: string, label: string): void {
  if (!E164.test(value)) {
    throw new Error(`${label} must look like +15551234567, got "${value}"`);
  }
}

export interface SmsReceipt extends DispatchReceipt {
  costCents?: number;
  currency?: string;
}

// Integer minor units from a vendor price (a decimal major-unit
// string or number). Empty stays unknown; Twilio reports an outbound
// charge as a negative decimal, so the magnitude is what lands.
export function centsOf(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : undefined;
}

export interface MessageCharge {
  costCents?: number;
  currency?: string;
}

export interface SmsAdapterOptions {
  to: string;
  from?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function checkText(text: string, name: string): void {
  if (typeof text !== "string" || text.length === 0) {
    throw new AdapterError(`${name} adapter refuses an empty text`);
  }
}

async function readBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw: raw.slice(0, 200) };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function basicAuth(user: string, password = ""): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

function receipt(adapter: string, id: string, chars: number): SmsReceipt {
  return { adapter, id, chars, at: new Date().toISOString() };
}

// Twilio. Posts a form to the 2010-04-01 Messages endpoint with basic
// auth. The Messages object's `price` field carries the charge as a
// negative decimal once it is final, `price_unit` the currency; a
// StatusCallback URL receives signed delivery events.

export const TWILIO_BASE_URL = "https://api.twilio.com";

export interface TwilioSmsOptions extends SmsAdapterOptions {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  statusCallback?: string;
  baseUrl?: string;
}

export class TwilioSmsAdapter implements RouterAdapter {
  readonly name = "twilio";
  protected readonly to: string;
  protected readonly from: string;
  protected readonly accountSid: string;
  protected readonly authToken: string;
  protected readonly messagingServiceSid?: string;
  protected readonly statusCallback?: string;
  protected readonly baseUrl: string;
  protected readonly fetchFn: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: TwilioSmsOptions) {
    assertE164(options.to, "to");
    if (!options.accountSid || !options.authToken) {
      throw new AdapterError(
        "twilio needs accountSid and authToken (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on Node)",
      );
    }
    if (options.messagingServiceSid === undefined) {
      if (options.from === undefined) {
        throw new AdapterError("twilio needs a from number or messagingServiceSid");
      }
      assertE164(options.from, "from");
    }
    this.to = options.to;
    this.from = options.from ?? "";
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.messagingServiceSid = options.messagingServiceSid;
    this.statusCallback = options.statusCallback;
    this.baseUrl = (options.baseUrl ?? TWILIO_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<SmsReceipt> {
    checkText(text, this.name);
    const url = `${this.baseUrl}/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const form = new URLSearchParams({ To: this.to, Body: text });
    if (this.messagingServiceSid !== undefined) {
      form.set("MessagingServiceSid", this.messagingServiceSid);
    } else {
      form.set("From", this.from);
    }
    if (this.statusCallback !== undefined) {
      form.set("StatusCallback", this.statusCallback);
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: basicAuth(this.accountSid, this.authToken),
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AdapterError(`twilio request failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      const code = typeof body.code === "number" ? body.code : undefined;
      const detail =
        typeof body.message === "string" ? body.message : response.statusText;
      const advice = code !== undefined ? twilioAdvice(code) : undefined;
      throw new AdapterError(
        `twilio got status ${response.status}` +
          (code !== undefined ? ` (code ${code})` : "") +
          `: ${detail}` +
          (advice !== undefined ? ` ${advice}` : ""),
        { status: response.status },
      );
    }
    const sid = str(body.sid);
    if (sid === undefined) {
      throw new AdapterError("twilio send returned no message sid");
    }
    const result = receipt(this.name, sid, text.length);
    const charge = twilioPrice(body);
    if (charge.costCents !== undefined) {
      result.costCents = charge.costCents;
      result.currency = charge.currency;
    }
    return result;
  }

  // The final charge for a sent message. Twilio writes `price` onto the
  // Message resource only after delivery settles, so the callback is
  // usually empty and a later fetch carries the number.
  async charge(providerMessageId: string): Promise<MessageCharge> {
    const url =
      `${this.baseUrl}/2010-04-01/Accounts/${this.accountSid}` +
      `/Messages/${encodeURIComponent(providerMessageId)}.json`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { authorization: basicAuth(this.accountSid, this.authToken) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AdapterError(`twilio charge failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      throw new AdapterError(`twilio got status ${response.status}`, {
        status: response.status,
      });
    }
    return twilioPrice(body);
  }
}

// Twilio's price fields: `price` (negative decimal) and `price_unit`.
export function twilioPrice(body: Record<string, unknown>): MessageCharge {
  const costCents = centsOf(body.price);
  return {
    costCents,
    currency:
      costCents !== undefined ? (str(body.price_unit) ?? "USD") : undefined,
  };
}

// The charge a signed Twilio status callback carries, when it carries
// one: `Price` and `PriceUnit` form parameters.
export function twilioCallbackPrice(
  params: URLSearchParams | Record<string, string>,
): MessageCharge {
  const get =
    params instanceof URLSearchParams
      ? (key: string) => params.get(key)
      : (key: string) => params[key];
  const costCents = centsOf(get("Price") ?? get("price"));
  const unit = get("PriceUnit") ?? get("price_unit");
  return {
    costCents,
    currency: costCents !== undefined ? (str(unit) ?? "USD") : undefined,
  };
}

// Twilio's request signature is HMAC-SHA1 over the callback URL plus
// every parameter, sorted by name, as name+value. crypto.subtle.verify
// compares in constant time.
export async function verifyTwilioSignature(options: {
  authToken: string;
  url: string;
  params: URLSearchParams | Record<string, string>;
  signature: string | null;
}): Promise<boolean> {
  const { authToken, url, params, signature } = options;
  if (!signature) return false;
  const entries =
    params instanceof URLSearchParams
      ? [...params.entries()]
      : Object.entries(params);
  const data = entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .reduce((acc, [key, value]) => acc + key + value, url);
  let given: Uint8Array;
  try {
    given = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    given as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(data),
  );
}

// Telnyx. Posts JSON to /v2/messages with a bearer key. The message
// object's `cost.amount` carries the charge as a decimal, `cost.currency`
// the currency; a webhook_url receives ed25519-signed delivery events.

export const TELNYX_BASE_URL = "https://api.telnyx.com";

export interface TelnyxSmsOptions extends SmsAdapterOptions {
  apiKey: string;
  messagingProfileId?: string;
  webhookUrl?: string;
  baseUrl?: string;
}

export class TelnyxSmsAdapter implements RouterAdapter {
  readonly name = "telnyx";
  protected readonly to: string;
  protected readonly from: string;
  protected readonly apiKey: string;
  protected readonly messagingProfileId?: string;
  protected readonly webhookUrl?: string;
  protected readonly baseUrl: string;
  protected readonly fetchFn: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: TelnyxSmsOptions) {
    assertE164(options.to, "to");
    if (options.from === undefined) {
      throw new AdapterError("telnyx needs a from number");
    }
    assertE164(options.from, "from");
    if (!options.apiKey) {
      throw new AdapterError("telnyx needs an apiKey (TELNYX_API_KEY on Node)");
    }
    this.to = options.to;
    this.from = options.from;
    this.apiKey = options.apiKey;
    this.messagingProfileId = options.messagingProfileId;
    this.webhookUrl = options.webhookUrl;
    this.baseUrl = (options.baseUrl ?? TELNYX_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<SmsReceipt> {
    checkText(text, this.name);
    const payload: Record<string, string> = {
      from: this.from,
      to: this.to,
      text,
    };
    if (this.messagingProfileId !== undefined) {
      payload.messaging_profile_id = this.messagingProfileId;
    }
    if (this.webhookUrl !== undefined) {
      payload.webhook_url = this.webhookUrl;
    }
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/v2/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AdapterError(`telnyx request failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      const errors = Array.isArray(body.errors) ? body.errors : [];
      const first = asRecord(errors[0]);
      const detail =
        typeof first.detail === "string"
          ? first.detail
          : typeof first.title === "string"
            ? first.title
            : response.statusText;
      throw new AdapterError(
        `telnyx got status ${response.status}: ${detail}`,
        { status: response.status },
      );
    }
    const data = asRecord(body.data);
    const id = str(data.id);
    if (id === undefined) {
      throw new AdapterError("telnyx send returned no message id");
    }
    const result = receipt(this.name, id, text.length);
    const charge = telnyxPrice(data);
    if (charge.costCents !== undefined) {
      result.costCents = charge.costCents;
      result.currency = charge.currency;
    }
    return result;
  }

  // The final charge for a sent message, once Telnyx writes `cost`
  // onto the message resource.
  async charge(providerMessageId: string): Promise<MessageCharge> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/v2/messages/${encodeURIComponent(providerMessageId)}`,
        {
          headers: { authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      throw new AdapterError(`telnyx charge failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      throw new AdapterError(`telnyx got status ${response.status}`, {
        status: response.status,
      });
    }
    return telnyxPrice(asRecord(body.data));
  }
}

// Telnyx's price fields: `cost.amount` (decimal) and `cost.currency`
// on a message object.
export function telnyxPrice(data: Record<string, unknown>): MessageCharge {
  const cost = asRecord(data.cost);
  const costCents = centsOf(cost.amount);
  return {
    costCents,
    currency:
      costCents !== undefined ? (str(cost.currency) ?? "USD") : undefined,
  };
}

// The charge a signed Telnyx webhook carries, when it carries one:
// `data.payload.cost.amount` / `data.payload.cost.currency`.
export function telnyxEventPrice(payload: unknown): MessageCharge {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const inner = asRecord(data.payload);
  return telnyxPrice(Object.keys(inner).length > 0 ? inner : data);
}

// Telnyx signs webhooks with ed25519: the signature (base64) covers
// `${telnyx-timestamp}|${raw body}` under the account public key. The
// timestamp header is unix seconds and must sit within
// `toleranceSeconds` of now (default five minutes), so a replayed
// webhook fails even with a valid signature. A malformed public key,
// signature, or verify failure returns false rather than throwing.
export const TELNYX_TOLERANCE_SECONDS = 300;

export async function verifyTelnyxSignature(options: {
  publicKey: string;
  timestamp: string;
  signature: string | null;
  payload: string;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { publicKey, timestamp, signature, payload } = options;
  if (!signature || !timestamp) return false;
  const tolerance = options.toleranceSeconds ?? TELNYX_TOLERANCE_SECONDS;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > tolerance) return false;
  let keyBytes: Uint8Array;
  let given: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
    given = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes as Uint8Array<ArrayBuffer>,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(`${timestamp}|${payload}`);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      given as Uint8Array<ArrayBuffer>,
      data,
    );
  } catch {
    return false;
  }
}

// Plivo. Posts JSON to the Message endpoint with basic auth.

export const PLIVO_BASE_URL = "https://api.plivo.com";

export interface PlivoSmsOptions extends SmsAdapterOptions {
  authId: string;
  authToken: string;
  callbackUrl?: string;
  baseUrl?: string;
}

export class PlivoSmsAdapter implements RouterAdapter {
  readonly name = "plivo";
  protected readonly to: string;
  protected readonly from: string;
  protected readonly authId: string;
  protected readonly authToken: string;
  protected readonly callbackUrl?: string;
  protected readonly baseUrl: string;
  protected readonly fetchFn: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: PlivoSmsOptions) {
    assertE164(options.to, "to");
    if (options.from === undefined) {
      throw new AdapterError("plivo needs a from number");
    }
    assertE164(options.from, "from");
    if (!options.authId || !options.authToken) {
      throw new AdapterError(
        "plivo needs authId and authToken (PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN on Node)",
      );
    }
    this.to = options.to;
    this.from = options.from;
    this.authId = options.authId;
    this.authToken = options.authToken;
    this.callbackUrl = options.callbackUrl;
    this.baseUrl = (options.baseUrl ?? PLIVO_BASE_URL).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<SmsReceipt> {
    checkText(text, this.name);
    const url = `${this.baseUrl}/v1/Account/${this.authId}/Message/`;
    const body: Record<string, string> = {
      src: this.from,
      dst: this.to,
      text,
    };
    if (this.callbackUrl !== undefined) body.url = this.callbackUrl;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: basicAuth(this.authId, this.authToken),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AdapterError(`plivo request failed: ${String(error)}`, {
        cause: error,
      });
    }
    const parsed = asRecord(await readBody(response));
    if (!response.ok) {
      const detail =
        typeof parsed.error === "string" ? parsed.error : response.statusText;
      throw new AdapterError(`plivo got status ${response.status}: ${detail}`, {
        status: response.status,
      });
    }
    const uuids = Array.isArray(parsed.message_uuid) ? parsed.message_uuid : [];
    const id = str(uuids[0]);
    if (id === undefined) {
      throw new AdapterError("plivo send returned no message id");
    }
    return receipt(this.name, id, text.length);
  }
}

// Dry-run stub. Delivers nothing and returns a marked receipt. The
// CLI and the MCP server use it for previews, so previews need no
// keys and spend nothing.

export class DryRunSmsAdapter implements RouterAdapter {
  readonly name = "dry-run";

  async dispatch(text: string): Promise<SmsReceipt> {
    checkText(text, this.name);
    return receipt(this.name, `dry-${crypto.randomUUID()}`, text.length);
  }
}

export interface CreateSmsAdapterOptions extends SmsAdapterOptions {
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
  twilioBaseUrl?: string;
  telnyxApiKey?: string;
  messagingProfileId?: string;
  webhookUrl?: string;
  telnyxBaseUrl?: string;
  plivoAuthId?: string;
  plivoAuthToken?: string;
  plivoBaseUrl?: string;
}

export function createSmsAdapter(
  vendor: SmsVendor,
  options: CreateSmsAdapterOptions,
): RouterAdapter {
  switch (vendor) {
    case "twilio":
      return new TwilioSmsAdapter({
        ...options,
        accountSid: options.twilioAccountSid ?? "",
        authToken: options.twilioAuthToken ?? "",
        baseUrl: options.twilioBaseUrl,
      });
    case "telnyx":
      return new TelnyxSmsAdapter({
        ...options,
        apiKey: options.telnyxApiKey ?? "",
        baseUrl: options.telnyxBaseUrl,
      });
    case "plivo":
      return new PlivoSmsAdapter({
        ...options,
        authId: options.plivoAuthId ?? "",
        authToken: options.plivoAuthToken ?? "",
        baseUrl: options.plivoBaseUrl,
      });
  }
}
