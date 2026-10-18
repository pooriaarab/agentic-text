#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createGuards,
  dispatchText,
  getCostReport,
  GuardError,
  VendorError,
} from "agentic-core";
import {
  assertE164,
  createSmsAdapter,
  DryRunSmsAdapter,
  vendorForEnv,
  type SmsVendor,
} from "./vendors.js";
import {
  defaultWarmbasePath,
  ensureWarm,
  WarmBase,
} from "./warmbase.js";
import {
  a2pChecklist,
  QUIET_DEFAULT,
  withOptOutFooter,
} from "./compliance.js";
import { ensureProspect, parseProspectCsv } from "./prospects.js";
import { DEFAULT_BRAND } from "./index.js";
import { VERSION } from "./version.js";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CliCommand =
  | "send"
  | "warmbase"
  | "stops"
  | "a2p"
  | "costs"
  | "mcp"
  | "help"
  | "version";

export interface CliRequest {
  command: CliCommand;
  action?: string;
  to?: string;
  from?: string;
  text?: string;
  file?: string;
  vendor?: SmsVendor;
  live: boolean;
  dryRun: boolean;
  warmbase?: string;
  cap?: number;
  quietStart?: number;
  quietEnd?: number;
  brand?: string;
  name?: string;
  source?: string;
  keyword?: string;
  prospectFile?: string;
}

const VENDORS: SmsVendor[] = ["twilio", "telnyx", "plivo"];

function parseIntFlag(flag: string, value: string, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(
      `${flag} needs an integer from ${min} to ${max}, got "${value}"`,
    );
  }
  return parsed;
}

function parsePhone(flag: string, value: string): string {
  try {
    assertE164(value, flag);
  } catch {
    throw new UsageError(`${flag} must look like +15551234567, got "${value}"`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliRequest {
  const request: CliRequest = { command: "help", live: false, dryRun: false };
  const args = [...argv];
  const first = args.shift();
  if (first === undefined || first === "--help" || first === "-h") {
    return request;
  }
  if (first === "--version" || first === "-V") {
    request.command = "version";
    return request;
  }
  if (
    first !== "send" &&
    first !== "warmbase" &&
    first !== "stops" &&
    first !== "a2p" &&
    first !== "costs" &&
    first !== "mcp"
  ) {
    throw new UsageError(`unknown command "${first}"`);
  }
  request.command = first;
  if (first === "warmbase" || first === "stops") {
    const action = args.shift();
    if (action !== "add" && action !== "list") {
      throw new UsageError(`${first} needs an action: add or list`);
    }
    request.action = action;
  }
  const valueFlags = new Set([
    "--to",
    "--from",
    "--text",
    "--file",
    "--vendor",
    "--warmbase",
    "--cap",
    "--quiet-start",
    "--quiet-end",
    "--brand",
    "--name",
    "--source",
    "--keyword",
    "--prospect-file",
  ]);
  while (args.length > 0) {
    const flag = args.shift() as string;
    if (flag === "--live" && first === "send") {
      request.live = true;
      continue;
    }
    if (flag === "--dry-run" && first === "send") {
      request.dryRun = true;
      continue;
    }
    if (valueFlags.has(flag) && args.length > 0) {
      const value = args.shift() as string;
      switch (flag) {
        case "--to":
          request.to = parsePhone("--to", value);
          break;
        case "--from":
          request.from = parsePhone("--from", value);
          break;
        case "--text":
          request.text = value;
          break;
        case "--file":
          request.file = value;
          break;
        case "--vendor":
          if (!VENDORS.includes(value as SmsVendor)) {
            throw new UsageError(
              `--vendor must be one of ${VENDORS.join(", ")}, got "${value}"`,
            );
          }
          request.vendor = value as SmsVendor;
          break;
        case "--warmbase":
          request.warmbase = value;
          break;
        case "--cap":
          request.cap = parseIntFlag("--cap", value, 0, 1_000_000);
          break;
        case "--quiet-start":
          request.quietStart = parseIntFlag("--quiet-start", value, 0, 24);
          break;
        case "--quiet-end":
          request.quietEnd = parseIntFlag("--quiet-end", value, 0, 24);
          break;
        case "--brand":
          request.brand = value;
          break;
        case "--name":
          request.name = value;
          break;
        case "--source":
          request.source = value;
          break;
        case "--keyword":
          request.keyword = value;
          break;
        case "--prospect-file":
          request.prospectFile = value;
          break;
      }
      continue;
    }
    throw new UsageError(`unknown flag "${flag}" for "${first}"`);
  }
  if (request.live && request.dryRun) {
    throw new UsageError("--live and --dry-run exclude each other");
  }
  if (request.command === "send") {
    if (request.to === undefined) throw new UsageError("send needs --to");
    if (request.from === undefined) throw new UsageError("send needs --from");
    if (request.text === undefined && request.file === undefined) {
      throw new UsageError("send needs --text or --file");
    }
    request.vendor = request.vendor ?? vendorForEnv() ?? "twilio";
  }
  if (request.command === "warmbase" && request.action === "add") {
    if (request.to === undefined) throw new UsageError("warmbase add needs --to");
    if (request.source === undefined) {
      throw new UsageError("warmbase add needs --source");
    }
  }
  if (request.command === "stops" && request.action === "add") {
    if (request.to === undefined) throw new UsageError("stops add needs --to");
  }
  return request;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): string;
  loadWarmbase(path: string): WarmBase;
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readFile: (path) => readFileSync(path, "utf8"),
    loadWarmbase: (path) => WarmBase.load(path),
  };
}

function helpText(): string {
  const command = DEFAULT_BRAND.command;
  return [
    `${DEFAULT_BRAND.name} ${VERSION}`,
    `${DEFAULT_BRAND.description}`,
    "",
    `Usage: ${command} <command> [flags]`,
    "",
    "Commands:",
    "  send --to <n> --from <n> --text <t> [--vendor v] [--live]",
    "      Send one text. Dry run is the default. Pass --live to send.",
    "  warmbase add --to <n> --source <s> [--name <n>]  Add an opted-in contact.",
    "  warmbase list                                    List opted-in contacts.",
    "  stops add --to <n> [--keyword <k>]               Log a STOP for a number.",
    "  stops list                                       List logged STOPs.",
    "  a2p                                              Print the A2P 10DLC checklist.",
    "  costs                                            Print the cost report as JSON.",
    "  mcp                                              Start the MCP server on stdio.",
    "",
    "Send flags:",
    "  --file <p>         Read the text from a file instead of --text.",
    "  --vendor <v>       twilio, telnyx, or plivo. Default follows env keys.",
    "  --live             Send for real. Without it the pack only previews.",
    "  --dry-run          Preview only. This is the default.",
    "  --brand <b>        Prefix the text with the brand and a STOP footer.",
    "  --warmbase <p>     Warm base file. Default is ~/.agentic-text/.",
    "  --prospect-file <p>  Prospect CSV with basis, evidence_url,",
    "                       no_solicitation_flag, do_not_contact columns.",
    "  --cap <n>          Refuse after n dispatches in this run.",
    "  --quiet-start <h>  Quiet window start, UTC hour. Default 1.",
    "  --quiet-end <h>    Quiet window end, UTC hour. Default 13.",
    "",
    "Flags:",
    "  --help, -h       Print this help.",
    "  --version, -V    Print the version.",
  ].join("\n");
}

function readInput(request: CliRequest, io: CliIo): string {
  if (request.file !== undefined) {
    return io.readFile(request.file);
  }
  return request.text ?? "";
}

function warmbasePath(request: CliRequest): string {
  return request.warmbase ?? defaultWarmbasePath();
}

export async function runCli(
  argv: string[],
  io: CliIo = defaultIo(),
): Promise<number> {
  let request: CliRequest;
  try {
    request = parseArgs(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(`Run "${DEFAULT_BRAND.command} --help" for usage.`);
    return 2;
  }
  try {
    switch (request.command) {
      case "help":
        io.out(helpText());
        return 0;
      case "version":
        io.out(VERSION);
        return 0;
      case "send": {
        const base = io.loadWarmbase(warmbasePath(request));
        ensureWarm(request.to as string, base);
        if (request.prospectFile !== undefined) {
          ensureProspect(
            parseProspectCsv(io.readFile(request.prospectFile)),
            request.to as string,
          );
        }
        const guards = createGuards({
          caps: request.cap === undefined ? {} : { maxDispatches: request.cap },
          quietHours: {
            startHour: request.quietStart ?? QUIET_DEFAULT.startHour,
            endHour: request.quietEnd ?? QUIET_DEFAULT.endHour,
          },
        });
        let text = readInput(request, io);
        if (request.brand !== undefined) {
          text = withOptOutFooter(request.brand, text);
        }
        if (request.live) {
          const adapter = createSmsAdapter(request.vendor as SmsVendor, {
            to: request.to as string,
            from: request.from as string,
          });
          const result = await dispatchText(text, { adapter, guards });
          io.out(JSON.stringify(result));
          return 0;
        }
        const preview = await dispatchText(text, {
          adapter: new DryRunSmsAdapter(),
          guards,
          dryRun: true,
        });
        io.out(JSON.stringify({ ...preview, vendor: request.vendor }));
        return 0;
      }
      case "warmbase": {
        const base = io.loadWarmbase(warmbasePath(request));
        if (request.action === "list") {
          io.out(JSON.stringify(base.listContacts()));
          return 0;
        }
        const contact = base.add({
          to: request.to as string,
          name: request.name,
          source: request.source as string,
        });
        base.save(warmbasePath(request));
        io.out(JSON.stringify(contact));
        return 0;
      }
      case "stops": {
        const base = io.loadWarmbase(warmbasePath(request));
        if (request.action === "list") {
          io.out(JSON.stringify(base.listStops()));
          return 0;
        }
        const entry = base.recordStop(
          request.to as string,
          request.keyword ?? "STOP",
        );
        base.save(warmbasePath(request));
        io.out(JSON.stringify(entry));
        return 0;
      }
      case "a2p":
        io.out(
          JSON.stringify({
            checklist: a2pChecklist(),
            vendors: {
              twilio: (process.env.TWILIO_ACCOUNT_SID ?? "").length > 0,
              telnyx: (process.env.TELNYX_API_KEY ?? "").length > 0,
              plivo: (process.env.PLIVO_AUTH_ID ?? "").length > 0,
            },
            warmbase: warmbasePath(request),
          }),
        );
        return 0;
      case "costs":
        io.out(JSON.stringify(getCostReport()));
        return 0;
      case "mcp": {
        const { startMcp } = await import("./mcp.js");
        await startMcp();
        return 0;
      }
    }
  } catch (error) {
    if (
      error instanceof GuardError ||
      error instanceof VendorError ||
      error instanceof UsageError
    ) {
      io.err(`${error.name}: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      io.err(
        `file not found: ${request.file ?? request.prospectFile ?? request.warmbase ?? ""}`,
      );
      return 1;
    }
    if (error instanceof Error && error.message.startsWith("warm base at")) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      // Exit nonzero at once. On zero, fall off the end so a running
      // server (mcp) keeps its stdio handles open. Plain commands
      // hold no handles and exit 0 on their own.
      if (code !== 0) process.exit(code);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
