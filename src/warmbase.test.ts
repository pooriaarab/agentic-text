import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GuardError } from "agentic-core";
import { ensureWarm, WarmBase } from "./warmbase.js";

const TO = "+15551234567";

describe("warm base", () => {
  test("add stores the contact with its source", () => {
    const base = new WarmBase();
    const contact = base.add({ to: TO, name: "Lee", source: "web form" });
    expect(contact).toMatchObject({ to: TO, name: "Lee", source: "web form" });
    expect(contact.optedInAt.length).toBeGreaterThan(0);
    expect(base.has(TO)).toBe(true);
    expect(base.size).toBe(1);
  });

  test("add needs a valid number and a source", () => {
    const base = new WarmBase();
    expect(() => base.add({ to: "bad", source: "x" })).toThrow(/must look like/);
    expect(() => base.add({ to: TO, source: "  " })).toThrow(/source/);
  });

  test("recordStop removes the contact and logs the keyword", () => {
    const base = new WarmBase();
    base.add({ to: TO, source: "web form" });
    const entry = base.recordStop(TO, "stopall");
    expect(entry).toMatchObject({ to: TO, keyword: "STOPALL" });
    expect(base.has(TO)).toBe(false);
    expect(base.isStopped(TO)).toBe(true);
    expect(base.listStops()).toHaveLength(1);
  });

  test("load of a missing file starts empty, save round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "warm-"));
    try {
      const path = join(dir, "sub", "warmbase.json");
      const base = WarmBase.load(path);
      expect(base.size).toBe(0);
      base.add({ to: TO, source: "import 2026-01-01" });
      base.recordStop("+15557654321", "STOP");
      base.save();
      const again = WarmBase.load(path);
      expect(again.get(TO)).toMatchObject({ source: "import 2026-01-01" });
      expect(again.isStopped("+15557654321")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("load of broken JSON throws a plain error", () => {
    const dir = mkdtempSync(join(tmpdir(), "warm-"));
    try {
      const path = join(dir, "warmbase.json");
      writeFileSync(path, "{nope", "utf8");
      expect(() => WarmBase.load(path)).toThrow(/not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureWarm", () => {
  test("passes warm numbers", () => {
    const base = new WarmBase();
    base.add({ to: TO, source: "web form" });
    expect(ensureWarm(TO, base).to).toBe(TO);
  });

  test("refuses cold numbers with GuardError", () => {
    expect(() => ensureWarm(TO, new WarmBase())).toThrowError(GuardError);
    expect(() => ensureWarm(TO, new WarmBase())).toThrow(/not in the warm base/);
  });

  test("refuses stopped numbers with GuardError", () => {
    const base = new WarmBase();
    base.recordStop(TO, "STOP");
    expect(() => ensureWarm(TO, base)).toThrow(/sent STOP/);
  });
});
