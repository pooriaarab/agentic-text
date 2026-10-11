import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { VERSION } from "./version.js";

describe("version", () => {
  test("matches package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
