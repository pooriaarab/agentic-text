import { randomUUID } from "node:crypto";
import {
  VendorError,
  type DispatchReceipt,
  type RouterAdapter,
} from "agentic-core";
import { twilioAdvice } from "./compliance.js";

export type SmsVendor = "twilio" | "telnyx" | "plivo";

const E164 = /^\+[1-9]\d{7,14}$/;

export function assertE164(value: string, label: string): void {
  if (!E164.test(value)) {
    throw new Error(`${label} must look like +15551234567, got "${value}"`);
  }
}

export interface SmsAdapterOptions {
  to: string;
  from: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function checkText(text: string, name: string): void {
  if (typeof text !== "string" || text.length === 0) {
    throw new VendorError(`${name} adapter refuses an empty text`);
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

function receipt(adapter: string, id: string, chars: number): DispatchReceipt {
  return { adapter, id, chars, at: new Date().toISOString() };
}

// Twilio. Posts a form to the 2010-04-01 Messages endpoint with
// basic auth. Reads TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.

export interface TwilioSmsOptions extends SmsAdapterOptions {
  accountSid?: string;
  authToken?: string;
  messagingServiceSid?: string;
}

export class TwilioSmsAdapter implements RouterAdapter {
  readonly name = "twilio";
  private readonly to: string;
  private readonly from: string;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly messagingServiceSid?: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TwilioSmsOptions) {
    assertE164(options.to, "to");
    const sid = options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "";
    const token = options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
    if (sid.length === 0 || token.length === 0) {
      throw new VendorError(
        "twilio needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
      );
    }
    if (options.messagingServiceSid === undefined) {
      assertE164(options.from, "from");
    }
    this.to = options.to;
    this.from = options.from;
    this.accountSid = sid;
    this.authToken = token;
    this.messagingServiceSid = options.messagingServiceSid;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<DispatchReceipt> {
    checkText(text, this.name);
    const url =
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const form = new URLSearchParams({ To: this.to, Body: text });
    if (this.messagingServiceSid !== undefined) {
      form.set("MessagingServiceSid", this.messagingServiceSid);
    } else {
      form.set("From", this.from);
    }
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VendorError(`twilio request failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      const code = typeof body.code === "number" ? body.code : undefined;
      const detail =
        typeof body.message === "string" ? body.message : response.statusText;
      const advice =
        code !== undefined ? twilioAdvice(code) : undefined;
      throw new VendorError(
        `twilio got status ${response.status}` +
          (code !== undefined ? ` (code ${code})` : "") +
          `: ${detail}` +
          (advice !== undefined ? ` ${advice}` : ""),
        { status: response.status },
      );
    }
    const sid = typeof body.sid === "string" ? body.sid : randomUUID();
    return receipt(this.name, sid, text.length);
  }
}

// Telnyx. Posts JSON to /v2/messages with a bearer key. Reads
// TELNYX_API_KEY. A messaging profile id is optional.

export interface TelnyxSmsOptions extends SmsAdapterOptions {
  apiKey?: string;
  messagingProfileId?: string;
}

export class TelnyxSmsAdapter implements RouterAdapter {
  readonly name = "telnyx";
  private readonly to: string;
  private readonly from: string;
  private readonly apiKey: string;
  private readonly messagingProfileId?: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TelnyxSmsOptions) {
    assertE164(options.to, "to");
    assertE164(options.from, "from");
    const key = options.apiKey ?? process.env.TELNYX_API_KEY ?? "";
    if (key.length === 0) {
      throw new VendorError("telnyx needs TELNYX_API_KEY");
    }
    this.to = options.to;
    this.from = options.from;
    this.apiKey = key;
    this.messagingProfileId = options.messagingProfileId;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<DispatchReceipt> {
    checkText(text, this.name);
    const payload: Record<string, string> = {
      from: this.from,
      to: this.to,
      text,
    };
    if (this.messagingProfileId !== undefined) {
      payload.messaging_profile_id = this.messagingProfileId;
    }
    let response: Response;
    try {
      response = await this.fetchFn("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VendorError(`telnyx request failed: ${String(error)}`, {
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
      throw new VendorError(
        `telnyx got status ${response.status}: ${detail}`,
        { status: response.status },
      );
    }
    const data = asRecord(body.data);
    const id = typeof data.id === "string" ? data.id : randomUUID();
    return receipt(this.name, id, text.length);
  }
}

// Plivo. Posts JSON to the Message endpoint with basic auth. Reads
// PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN.

export interface PlivoSmsOptions extends SmsAdapterOptions {
  authId?: string;
  authToken?: string;
}

export class PlivoSmsAdapter implements RouterAdapter {
  readonly name = "plivo";
  private readonly to: string;
  private readonly from: string;
  private readonly authId: string;
  private readonly authToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PlivoSmsOptions) {
    assertE164(options.to, "to");
    assertE164(options.from, "from");
    const id = options.authId ?? process.env.PLIVO_AUTH_ID ?? "";
    const token = options.authToken ?? process.env.PLIVO_AUTH_TOKEN ?? "";
    if (id.length === 0 || token.length === 0) {
      throw new VendorError("plivo needs PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN");
    }
    this.to = options.to;
    this.from = options.from;
    this.authId = id;
    this.authToken = token;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dispatch(text: string): Promise<DispatchReceipt> {
    checkText(text, this.name);
    const url = `https://api.plivo.com/v1/Account/${this.authId}/Message/`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(`${this.authId}:${this.authToken}`).toString("base64")}`,
        },
        body: JSON.stringify({ src: this.from, dst: this.to, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new VendorError(`plivo request failed: ${String(error)}`, {
        cause: error,
      });
    }
    const body = asRecord(await readBody(response));
    if (!response.ok) {
      const detail =
        typeof body.error === "string" ? body.error : response.statusText;
      throw new VendorError(`plivo got status ${response.status}: ${detail}`, {
        status: response.status,
      });
    }
    const uuids = Array.isArray(body.message_uuid) ? body.message_uuid : [];
    const id =
      typeof uuids[0] === "string" ? (uuids[0] as string) : randomUUID();
    return receipt(this.name, id, text.length);
  }
}

// Dry-run stub. Delivers nothing and returns a marked receipt. The
// CLI and the MCP server use it for previews, so previews need no
// keys and spend nothing.

export class DryRunSmsAdapter implements RouterAdapter {
  readonly name = "dry-run";

  async dispatch(text: string): Promise<DispatchReceipt> {
    checkText(text, this.name);
    return receipt(this.name, `dry-${randomUUID()}`, text.length);
  }
}

export interface CreateSmsAdapterOptions extends SmsAdapterOptions {
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  messagingServiceSid?: string;
  telnyxApiKey?: string;
  messagingProfileId?: string;
  plivoAuthId?: string;
  plivoAuthToken?: string;
}

export function createSmsAdapter(
  vendor: SmsVendor,
  options: CreateSmsAdapterOptions,
): RouterAdapter {
  switch (vendor) {
    case "twilio":
      return new TwilioSmsAdapter({
        ...options,
        accountSid: options.twilioAccountSid,
        authToken: options.twilioAuthToken,
      });
    case "telnyx":
      return new TelnyxSmsAdapter({
        ...options,
        apiKey: options.telnyxApiKey,
      });
    case "plivo":
      return new PlivoSmsAdapter({
        ...options,
        authId: options.plivoAuthId,
        authToken: options.plivoAuthToken,
      });
  }
}

export function vendorForEnv(): SmsVendor | undefined {
  if ((process.env.TWILIO_ACCOUNT_SID ?? "").length > 0) return "twilio";
  if ((process.env.TELNYX_API_KEY ?? "").length > 0) return "telnyx";
  if ((process.env.PLIVO_AUTH_ID ?? "").length > 0) return "plivo";
  return undefined;
}
