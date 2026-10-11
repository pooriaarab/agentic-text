import { describe, expect, test } from "vitest";
import * as core from "agentic-core";
import * as pack from "./index.js";

// The pack re-exports the frozen core unchanged. Identity pins the
// two together, so drift fails here instead of in production.

describe("frozen core contract", () => {
  test("pack re-exports match agentic-core", () => {
    expect(pack.defineBrand).toBe(core.defineBrand);
    expect(pack.createLogger).toBe(core.createLogger);
    expect(pack.GuardError).toBe(core.GuardError);
    expect(pack.VendorError).toBe(core.VendorError);
    expect(pack.createGuards).toBe(core.createGuards);
    expect(pack.LocalRouterAdapter).toBe(core.LocalRouterAdapter);
    expect(pack.HttpRouterAdapter).toBe(core.HttpRouterAdapter);
    expect(pack.recordCost).toBe(core.recordCost);
    expect(pack.getCostReport).toBe(core.getCostReport);
    expect(pack.resetCosts).toBe(core.resetCosts);
    expect(pack.createDryRunResult).toBe(core.createDryRunResult);
    expect(pack.dispatchText).toBe(core.dispatchText);
    expect(pack.summarizeText).toBe(core.summarizeText);
  });

  test("brand is frozen and pack shaped", () => {
    expect(Object.isFrozen(pack.DEFAULT_BRAND)).toBe(true);
    expect(pack.DEFAULT_BRAND.command).toBe("agentic-text");
    expect(pack.DEFAULT_BRAND.keywords).toContain("sms");
  });
});
