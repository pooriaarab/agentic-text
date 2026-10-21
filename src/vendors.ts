import type { RouterAdapter } from "agentic-core";
import {
  PlivoSmsAdapter as FetchPlivoSmsAdapter,
  TelnyxSmsAdapter as FetchTelnyxSmsAdapter,
  TwilioSmsAdapter as FetchTwilioSmsAdapter,
} from "./adapters.js";
import type { SmsAdapterOptions } from "./adapters.js";

// Vendor adapters for the SDK, CLI, and MCP faces. The fetch-only
// implementations live in ./adapters.js; these subclasses add the
// env fallbacks so the Node entry points keep working unchanged.

export type { SmsAdapterOptions, SmsVendor } from "./adapters.js";
export {
  assertE164,
  centsOf,
  DryRunSmsAdapter,
  PLIVO_BASE_URL,
  TELNYX_BASE_URL,
  telnyxEventPrice,
  telnyxPrice,
  TWILIO_BASE_URL,
  twilioCallbackPrice,
  twilioPrice,
  verifyTelnyxSignature,
  verifyTwilioSignature,
} from "./adapters.js";
export type {
  MessageCharge,
  SmsReceipt,
} from "./adapters.js";

export interface TwilioSmsOptions extends SmsAdapterOptions {
  accountSid?: string;
  authToken?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
  baseUrl?: string;
}

export class TwilioSmsAdapter extends FetchTwilioSmsAdapter {
  constructor(options: TwilioSmsOptions) {
    super({
      ...options,
      accountSid: options.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: options.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    });
  }
}

export interface TelnyxSmsOptions extends SmsAdapterOptions {
  apiKey?: string;
  messagingProfileId?: string;
  webhookUrl?: string;
  baseUrl?: string;
}

export class TelnyxSmsAdapter extends FetchTelnyxSmsAdapter {
  constructor(options: TelnyxSmsOptions) {
    super({
      ...options,
      apiKey: options.apiKey ?? process.env.TELNYX_API_KEY ?? "",
    });
  }
}

export interface PlivoSmsOptions extends SmsAdapterOptions {
  authId?: string;
  authToken?: string;
  callbackUrl?: string;
  baseUrl?: string;
}

export class PlivoSmsAdapter extends FetchPlivoSmsAdapter {
  constructor(options: PlivoSmsOptions) {
    super({
      ...options,
      authId: options.authId ?? process.env.PLIVO_AUTH_ID ?? "",
      authToken: options.authToken ?? process.env.PLIVO_AUTH_TOKEN ?? "",
    });
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
  vendor: "twilio" | "telnyx" | "plivo",
  options: CreateSmsAdapterOptions,
): RouterAdapter {
  switch (vendor) {
    case "twilio":
      return new TwilioSmsAdapter({
        ...options,
        accountSid: options.twilioAccountSid,
        authToken: options.twilioAuthToken,
        baseUrl: options.twilioBaseUrl,
      });
    case "telnyx":
      return new TelnyxSmsAdapter({
        ...options,
        apiKey: options.telnyxApiKey,
        baseUrl: options.telnyxBaseUrl,
      });
    case "plivo":
      return new PlivoSmsAdapter({
        ...options,
        authId: options.plivoAuthId,
        authToken: options.plivoAuthToken,
        baseUrl: options.plivoBaseUrl,
      });
  }
}

export function vendorForEnv(): "twilio" | "telnyx" | "plivo" | undefined {
  if ((process.env.TWILIO_ACCOUNT_SID ?? "").length > 0) return "twilio";
  if ((process.env.TELNYX_API_KEY ?? "").length > 0) return "telnyx";
  if ((process.env.PLIVO_AUTH_ID ?? "").length > 0) return "plivo";
  return undefined;
}
