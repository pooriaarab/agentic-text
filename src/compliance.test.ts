import { describe, expect, test } from "vitest";
import {
  a2pChecklist,
  classifyInbound,
  hasOptOutNotice,
  twilioAdvice,
  validateA2PCampaign,
  withOptOutFooter,
} from "./compliance.js";

describe("classifyInbound", () => {
  test("spots stop keywords in any case", () => {
    for (const word of [
      "STOP",
      "stopall",
      "Unsubscribe",
      "CANCEL",
      "end",
      "quit please",
    ]) {
      expect(classifyInbound(word)).toBe("stop");
    }
  });

  test("spots help and start keywords", () => {
    expect(classifyInbound("HELP")).toBe("help");
    expect(classifyInbound("info")).toBe("help");
    expect(classifyInbound("START")).toBe("start");
    expect(classifyInbound("yes")).toBe("start");
  });

  test("marks the rest unknown", () => {
    expect(classifyInbound("thanks")).toBe("unknown");
    expect(classifyInbound("")).toBe("unknown");
  });
});

describe("opt-out footer", () => {
  test("detects a STOP notice", () => {
    expect(hasOptOutNotice("Reply STOP to opt out.")).toBe(true);
    expect(hasOptOutNotice("See you soon")).toBe(false);
  });

  test("adds brand and footer once", () => {
    expect(withOptOutFooter("Acme", "Doors open at 9")).toBe(
      "Acme: Doors open at 9 Reply STOP to opt out.",
    );
    expect(withOptOutFooter("Acme", "Hi. Reply STOP to opt out.")).toBe(
      "Acme: Hi. Reply STOP to opt out.",
    );
  });
});

describe("twilioAdvice", () => {
  test("advises known codes", () => {
    expect(twilioAdvice(21610)).toContain("opted out");
    expect(twilioAdvice(30034)).toContain("10DLC");
  });

  test("returns undefined for the rest", () => {
    expect(twilioAdvice(12345)).toBeUndefined();
  });
});

describe("a2p campaign", () => {
  const full = {
    brandName: "Acme",
    brandContactEmail: "hi@example.com",
    useCase: "marketing",
    optInFlow: "Web form with unchecked box.",
    sampleOptIn: "Acme: you joined deals. Reply STOP to opt out.",
    sampleOptOut: "Acme: you left deals. No more texts.",
    sampleHelp: "Acme deals: 4 texts a month. Reply STOP to opt out.",
    helpMessage: "Acme deals help: mail hi@example.com.",
  };

  test("passes a full campaign", () => {
    expect(validateA2PCampaign(full)).toEqual({ ok: true, missing: [] });
  });

  test("names each gap", () => {
    const check = validateA2PCampaign({ brandName: "Acme" });
    expect(check.ok).toBe(false);
    expect(check.missing).toContain("campaign use case");
    expect(check.missing).toContain("opt-in flow");
  });

  test("rejects a bad use case", () => {
    const check = validateA2PCampaign({ ...full, useCase: "spam" });
    expect(check.ok).toBe(false);
    expect(check.missing.join(" ")).toContain("use case");
  });
});

describe("a2pChecklist", () => {
  test("lists steps, cases, and vendor links", () => {
    const list = a2pChecklist();
    expect(list.steps.length).toBeGreaterThan(3);
    expect(list.useCases).toContain("marketing");
    expect(list.vendorLinks.twilio).toContain("twilio.com");
    expect(list.vendorLinks.telnyx).toContain("telnyx.com");
    expect(list.vendorLinks.plivo).toContain("plivo.com");
    expect(list.quietNote).toContain("UTC");
  });
});
