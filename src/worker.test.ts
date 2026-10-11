import { describe, expect, test } from "vitest";
import worker from "./worker.js";
import { VERSION } from "./version.js";

describe("worker", () => {
  test("health answers with pack and version", async () => {
    const response = await worker.fetch(
      new Request("https://pack/health"),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      pack: "agentic-text",
      version: VERSION,
    });
  });

  test("preview checks shape and never sends", async () => {
    const response = await worker.fetch(
      new Request("https://pack/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Doors open at 9" }),
      }),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dryRun: true,
      chars: 15,
      inboundKind: "unknown",
      hasOptOutNotice: false,
    });
  });

  test("preview flags stop texts", async () => {
    const response = await worker.fetch(
      new Request("https://pack/preview", {
        method: "POST",
        body: JSON.stringify({ text: "STOP" }),
      }),
      {},
    );
    expect(await response.json()).toMatchObject({ inboundKind: "stop" });
  });

  test("bad bodies and paths fail clean", async () => {
    const bad = await worker.fetch(
      new Request("https://pack/preview", { method: "POST", body: "nope" }),
      {},
    );
    expect(bad.status).toBe(400);
    const missing = await worker.fetch(
      new Request("https://pack/nowhere"),
      {},
    );
    expect(missing.status).toBe(404);
  });
});
