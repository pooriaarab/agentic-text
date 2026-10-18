import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseArgs, runCli, type CliIo } from "./cli.js";
import { WarmBase } from "./warmbase.js";

const TO = "+15551234567";
const FROM = "+15557654321";

function testIo(overrides: Partial<CliIo> = {}): CliIo & {
  outLines: string[];
  errLines: string[];
} {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
    readFile: (path) => `file:${path}`,
    loadWarmbase: () => new WarmBase(),
    ...overrides,
  };
}

function warmIo(): CliIo & { outLines: string[]; errLines: string[] } {
  const base = new WarmBase();
  base.add({ to: TO, source: "web form" });
  return testIo({ loadWarmbase: () => base });
}

afterEach(() => {
  for (const key of [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TELNYX_API_KEY",
    "PLIVO_AUTH_ID",
    "PLIVO_AUTH_TOKEN",
  ]) {
    delete process.env[key];
  }
});

describe("parseArgs", () => {
  test("empty args print help", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  test("send takes to, from, and text", () => {
    const request = parseArgs([
      "send",
      "--to",
      TO,
      "--from",
      FROM,
      "--text",
      "hi",
    ]);
    expect(request.command).toBe("send");
    expect(request.live).toBe(false);
    expect(request.vendor).toBe("twilio");
  });

  test("send rejects bad numbers and vendors", () => {
    expect(() =>
      parseArgs(["send", "--to", "bad", "--from", FROM, "--text", "hi"]),
    ).toThrow(/must look like/);
    expect(() =>
      parseArgs([
        "send",
        "--to",
        TO,
        "--from",
        FROM,
        "--text",
        "hi",
        "--vendor",
        "smoke",
      ]),
    ).toThrow(/--vendor/);
  });

  test("--live and --dry-run exclude each other", () => {
    expect(() =>
      parseArgs([
        "send",
        "--to",
        TO,
        "--from",
        FROM,
        "--text",
        "hi",
        "--live",
        "--dry-run",
      ]),
    ).toThrow(/exclude/);
  });

  test("send needs to, from, and a body", () => {
    expect(() => parseArgs(["send", "--from", FROM, "--text", "hi"])).toThrow(
      /--to/,
    );
    expect(() =>
      parseArgs(["send", "--to", TO, "--from", FROM]),
    ).toThrow(/--text or --file/);
  });

  test("warmbase and stops need an action", () => {
    expect(() => parseArgs(["warmbase"])).toThrow(/add or list/);
    expect(() => parseArgs(["stops", "drop"])).toThrow(/add or list/);
    expect(
      parseArgs(["warmbase", "add", "--to", TO, "--source", "s"]).action,
    ).toBe("add");
  });
});

describe("runCli", () => {
  test("send previews by default and spends nothing", async () => {
    const io = warmIo();
    const code = await runCli(
      [
        "send",
        "--to",
        TO,
        "--from",
        FROM,
        "--text",
        "hi",
        "--quiet-start",
        "0",
        "--quiet-end",
        "0",
      ],
      io,
    );
    expect(code).toBe(0);
    const preview = JSON.parse(io.outLines[0] as string) as {
      dryRun: boolean;
      vendor: string;
    };
    expect(preview.dryRun).toBe(true);
    expect(preview.vendor).toBe("twilio");
  });

  test("send refuses cold numbers", async () => {
    const io = testIo();
    const code = await runCli(
      ["send", "--to", TO, "--from", FROM, "--text", "hi"],
      io,
    );
    expect(code).toBe(1);
    expect(io.errLines.join(" ")).toContain("not in the warm base");
  });

  test("send refuses stopped numbers", async () => {
    const base = new WarmBase();
    base.recordStop(TO, "STOP");
    const io = testIo({ loadWarmbase: () => base });
    const code = await runCli(
      ["send", "--to", TO, "--from", FROM, "--text", "hi"],
      io,
    );
    expect(code).toBe(1);
    expect(io.errLines.join(" ")).toContain("sent STOP");
  });

  test("send enforces prospect compliance columns", async () => {
    const csv = (flag: string, contact = TO) =>
      [
        "phone,basis,evidence_url,no_solicitation_flag,do_not_contact",
        `${contact},prior purchase,https://example.com/consent/1,${flag},false`,
      ].join("\n");
    const sendWith = (csvText: string) => {
      const base = new WarmBase();
      base.add({ to: TO, source: "web form" });
      const io = testIo({
        loadWarmbase: () => base,
        readFile: () => csvText,
      });
      return runCli(
        [
          "send",
          "--to",
          TO,
          "--from",
          FROM,
          "--text",
          "hi",
          "--quiet-start",
          "0",
          "--quiet-end",
          "0",
          "--prospect-file",
          "prospects.csv",
        ],
        io,
      ).then((code) => ({ code, io }));
    };
    expect((await sendWith(csv("false"))).code).toBe(0);
    for (const bad of [csv("true"), csv("false", "+15550000000")]) {
      const { code, io } = await sendWith(bad);
      expect(code).toBe(1);
      expect(io.errLines.join(" ")).toMatch(/do-not-contact|no-solicitation|no prospect row/);
    }
  });

  test("send honors quiet hours", async () => {
    const io = warmIo();
    const code = await runCli(
      [
        "send",
        "--to",
        TO,
        "--from",
        FROM,
        "--text",
        "hi",
        "--quiet-start",
        "0",
        "--quiet-end",
        "24",
      ],
      io,
    );
    expect(code).toBe(1);
    expect(io.errLines.join(" ")).toContain("quiet hours");
  });

  test("live send without keys fails loud", async () => {
    const io = warmIo();
    const code = await runCli(
      ["send", "--to", TO, "--from", FROM, "--text", "hi", "--live"],
      io,
    );
    expect(code).toBe(1);
    expect(io.errLines.join(" ")).toContain("TWILIO_ACCOUNT_SID");
  });

  test("warmbase add and list round-trip through a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    try {
      const path = join(dir, "warmbase.json");
      const io = testIo({ loadWarmbase: (p) => WarmBase.load(p) });
      const added = await runCli(
        ["warmbase", "add", "--to", TO, "--source", "web form", "--warmbase", path],
        io,
      );
      expect(added).toBe(0);
      const listed = await runCli(["warmbase", "list", "--warmbase", path], io);
      expect(listed).toBe(0);
      const contacts = JSON.parse(io.outLines[1] as string) as { to: string }[];
      expect(contacts).toHaveLength(1);
      expect(contacts[0]?.to).toBe(TO);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stops add and list round-trip through a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-"));
    try {
      const path = join(dir, "warmbase.json");
      const io = testIo({ loadWarmbase: (p) => WarmBase.load(p) });
      await runCli(
        ["warmbase", "add", "--to", TO, "--source", "web form", "--warmbase", path],
        io,
      );
      const code = await runCli(
        ["stops", "add", "--to", TO, "--warmbase", path],
        io,
      );
      expect(code).toBe(0);
      expect(JSON.parse(io.outLines[1] as string)).toMatchObject({
        to: TO,
        keyword: "STOP",
      });
      await runCli(["stops", "list", "--warmbase", path], io);
      expect(
        (JSON.parse(io.outLines[2] as string) as unknown[]).length,
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a2p prints steps and key presence, never values", async () => {
    process.env.TELNYX_API_KEY = "secret-value";
    const io = testIo();
    const code = await runCli(["a2p"], io);
    expect(code).toBe(0);
    const body = JSON.parse(io.outLines[0] as string) as {
      checklist: { steps: string[] };
      vendors: Record<string, boolean>;
    };
    expect(body.checklist.steps.length).toBeGreaterThan(3);
    expect(body.vendors.telnyx).toBe(true);
    expect(body.vendors.twilio).toBe(false);
    expect(io.outLines[0]).not.toContain("secret-value");
  });

  test("unknown command exits 2 with usage", async () => {
    const io = testIo();
    const code = await runCli(["blast"], io);
    expect(code).toBe(2);
    expect(io.errLines.join(" ")).toContain("--help");
  });
});
