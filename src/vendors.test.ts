import { describe, expect, test, vi, afterEach } from "vitest";
import { AdapterError } from "./adapters.js";
import {
  createSmsAdapter,
  DryRunSmsAdapter,
  PlivoSmsAdapter,
  TelnyxSmsAdapter,
  TwilioSmsAdapter,
  vendorForEnv,
} from "./vendors.js";

const TO = "+15551234567";
const FROM = "+15557654321";

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TELNYX_API_KEY",
  "PLIVO_AUTH_ID",
  "PLIVO_AUTH_TOKEN",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

describe("twilio adapter", () => {
  test("posts a form with basic auth and returns the sid", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit): Promise<Response> =>
        jsonResponse({ sid: "SM123" }, 201),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const adapter = new TwilioSmsAdapter({
      to: TO,
      from: FROM,
      accountSid: "AC123",
      authToken: "tok",
      fetchFn,
    });
    const receipt = await adapter.dispatch("hi");
    expect(receipt).toMatchObject({ adapter: "twilio", id: "SM123", chars: 2 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("AC123:tok").toString("base64")}`,
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get("To")).toBe(TO);
    expect(form.get("From")).toBe(FROM);
    expect(form.get("Body")).toBe("hi");
  });

  test("uses the messaging service sid when set", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit): Promise<Response> =>
        jsonResponse({ sid: "SM9" }, 201),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const adapter = new TwilioSmsAdapter({
      to: TO,
      from: FROM,
      accountSid: "AC1",
      authToken: "t",
      messagingServiceSid: "MG1",
      fetchFn,
    });
    await adapter.dispatch("hi");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = new URLSearchParams(init.body as string);
    expect(form.get("MessagingServiceSid")).toBe("MG1");
    expect(form.get("From")).toBeNull();
  });

  test("throws AdapterError with code advice on failure", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ code: 21610, message: "opted out" }, 400),
    ) as unknown as typeof fetch;
    const adapter = new TwilioSmsAdapter({
      to: TO,
      from: FROM,
      accountSid: "AC1",
      authToken: "t",
      fetchFn,
    });
    const error = await adapter.dispatch("hi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as Error).message).toContain("21610");
    expect((error as Error).message).toContain("opted out");
    expect((error as AdapterError).status).toBe(400);
  });

  test("throws AdapterError on network failure, never swallows", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const adapter = new TwilioSmsAdapter({
      to: TO,
      from: FROM,
      accountSid: "AC1",
      authToken: "t",
      fetchFn,
    });
    await expect(adapter.dispatch("hi")).rejects.toBeInstanceOf(AdapterError);
  });

  test("needs credentials", () => {
    expect(() => new TwilioSmsAdapter({ to: TO, from: FROM })).toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
  });

  test("rejects bad numbers and empty text", async () => {
    expect(
      () =>
        new TwilioSmsAdapter({
          to: "5551234",
          from: FROM,
          accountSid: "A",
          authToken: "t",
        }),
    ).toThrow(/must look like/);
    const adapter = new TwilioSmsAdapter({
      to: TO,
      from: FROM,
      accountSid: "A",
      authToken: "t",
      fetchFn: (async () => jsonResponse({}, 201)) as unknown as typeof fetch,
    });
    await expect(adapter.dispatch("")).rejects.toBeInstanceOf(AdapterError);
  });
});

describe("telnyx adapter", () => {
  test("posts JSON with bearer auth and returns the id", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit): Promise<Response> =>
        jsonResponse({ data: { id: "msg1" } }, 200),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const adapter = new TelnyxSmsAdapter({
      to: TO,
      from: FROM,
      apiKey: "key",
      fetchFn,
    });
    const receipt = await adapter.dispatch("hey");
    expect(receipt).toMatchObject({ adapter: "telnyx", id: "msg1", chars: 3 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telnyx.com/v2/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: FROM,
      to: TO,
      text: "hey",
    });
  });

  test("throws AdapterError with the first error detail", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ errors: [{ code: "1000", detail: "bad from" }] }, 422),
    ) as unknown as typeof fetch;
    const adapter = new TelnyxSmsAdapter({
      to: TO,
      from: FROM,
      apiKey: "key",
      fetchFn,
    });
    const error = await adapter.dispatch("hey").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as Error).message).toContain("bad from");
    expect((error as AdapterError).status).toBe(422);
  });

  test("needs an api key", () => {
    expect(() => new TelnyxSmsAdapter({ to: TO, from: FROM })).toThrow(
      /TELNYX_API_KEY/,
    );
  });
});

describe("plivo adapter", () => {
  test("posts JSON with basic auth and returns the uuid", async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit): Promise<Response> =>
        jsonResponse({ message_uuid: ["u1"], message: "queued" }, 202),
    );
    const fetchFn = fetchMock as unknown as typeof fetch;
    const adapter = new PlivoSmsAdapter({
      to: TO,
      from: FROM,
      authId: "MA1",
      authToken: "tok",
      fetchFn,
    });
    const receipt = await adapter.dispatch("yo");
    expect(receipt).toMatchObject({ adapter: "plivo", id: "u1", chars: 2 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.plivo.com/v1/Account/MA1/Message/");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("MA1:tok").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      src: FROM,
      dst: TO,
      text: "yo",
    });
  });

  test("throws AdapterError with the error text", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: "dst invalid" }, 400),
    ) as unknown as typeof fetch;
    const adapter = new PlivoSmsAdapter({
      to: TO,
      from: FROM,
      authId: "MA1",
      authToken: "tok",
      fetchFn,
    });
    const error = await adapter.dispatch("yo").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as Error).message).toContain("dst invalid");
  });

  test("needs credentials", () => {
    expect(() => new PlivoSmsAdapter({ to: TO, from: FROM })).toThrow(
      /PLIVO_AUTH_ID/,
    );
  });
});

describe("dry-run stub", () => {
  test("returns a marked receipt without network", async () => {
    const receipt = await new DryRunSmsAdapter().dispatch("hi");
    expect(receipt.adapter).toBe("dry-run");
    expect(receipt.id.startsWith("dry-")).toBe(true);
    expect(receipt.chars).toBe(2);
  });
});

describe("factory", () => {
  test("builds each vendor from env", () => {
    process.env.TWILIO_ACCOUNT_SID = "A";
    process.env.TWILIO_AUTH_TOKEN = "t";
    process.env.TELNYX_API_KEY = "k";
    process.env.PLIVO_AUTH_ID = "M";
    process.env.PLIVO_AUTH_TOKEN = "p";
    expect(
      createSmsAdapter("twilio", { to: TO, from: FROM }).name,
    ).toBe("twilio");
    expect(
      createSmsAdapter("telnyx", { to: TO, from: FROM }).name,
    ).toBe("telnyx");
    expect(createSmsAdapter("plivo", { to: TO, from: FROM }).name).toBe(
      "plivo",
    );
  });

  test("vendorForEnv follows key presence", () => {
    expect(vendorForEnv()).toBeUndefined();
    process.env.PLIVO_AUTH_ID = "M";
    expect(vendorForEnv()).toBe("plivo");
    process.env.TELNYX_API_KEY = "k";
    expect(vendorForEnv()).toBe("telnyx");
    process.env.TWILIO_ACCOUNT_SID = "A";
    expect(vendorForEnv()).toBe("twilio");
  });
});
