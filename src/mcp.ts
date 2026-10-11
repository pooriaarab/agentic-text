import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createGuards,
  createLogger,
  dispatchText,
  getCostReport,
  GuardError,
  VendorError,
  type Guards,
  type Logger,
} from "agentic-core";
import {
  assertE164,
  createSmsAdapter,
  DryRunSmsAdapter,
} from "./vendors.js";
import {
  defaultWarmbasePath,
  ensureWarm,
  WarmBase,
} from "./warmbase.js";
import { a2pChecklist, QUIET_DEFAULT } from "./compliance.js";
import { DEFAULT_BRAND } from "./index.js";

export interface McpDeps {
  guards?: Guards;
  logger?: Logger;
  warmbasePath?: string;
  fetchFn?: typeof fetch;
}

const vendorEnum = z
  .enum(["twilio", "telnyx", "plivo"])
  .optional()
  .describe("Vendor. Default is twilio.");

function errorResult(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function okResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function checkPhone(value: string, label: string): void {
  try {
    assertE164(value, label);
  } catch {
    throw new Error(`${label} must look like +15551234567, got "${value}"`);
  }
}

export function createMcpServer(deps: McpDeps = {}): McpServer {
  const logger = deps.logger ?? createLogger({ quiet: true });
  const guards =
    deps.guards ??
    createGuards({
      quietHours: {
        startHour: QUIET_DEFAULT.startHour,
        endHour: QUIET_DEFAULT.endHour,
      },
    });
  const warmbasePath = deps.warmbasePath ?? defaultWarmbasePath();
  const fetchFn = deps.fetchFn;
  const server = new McpServer({
    name: DEFAULT_BRAND.command,
    version: DEFAULT_BRAND.version,
  });

  server.registerTool(
    "send_text",
    {
      description:
        "Send one text to a warm contact. Dry run is the default. Pass dryRun false to send.",
      inputSchema: {
        to: z.string().describe("Recipient in E.164 form, like +15551234567."),
        from: z
          .string()
          .optional()
          .describe("Sender in E.164 form. Needed for live sends."),
        text: z.string().describe("The text to send."),
        vendor: vendorEnum,
        dryRun: z
          .boolean()
          .optional()
          .describe("Preview only. Default is true."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, from, text, vendor, dryRun }) => {
      try {
        checkPhone(to, "to");
        const base = WarmBase.load(warmbasePath);
        ensureWarm(to, base);
        const live = dryRun === false;
        if (live) {
          if (from === undefined) {
            return errorResult(new Error("live send needs a from number"));
          }
          checkPhone(from, "from");
          const adapter = createSmsAdapter(vendor ?? "twilio", {
            to,
            from,
            fetchFn,
          });
          return okResult(
            await dispatchText(text, { adapter, guards, logger }),
          );
        }
        const preview = await dispatchText(text, {
          adapter: new DryRunSmsAdapter(),
          guards,
          logger,
          dryRun: true,
        });
        return okResult({ ...preview, vendor: vendor ?? "twilio" });
      } catch (error) {
        if (
          error instanceof GuardError ||
          error instanceof VendorError ||
          error instanceof Error
        ) {
          return errorResult(error);
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "warmbase_add",
    {
      description: "Add an opted-in contact with its opt-in source.",
      inputSchema: {
        to: z.string().describe("Contact number in E.164 form."),
        source: z.string().describe("Where opt-in happened."),
        name: z.string().optional().describe("Contact name."),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ to, source, name }) => {
      try {
        checkPhone(to, "to");
        const base = WarmBase.load(warmbasePath);
        const contact = base.add({ to, source, name });
        base.save(warmbasePath);
        return okResult(contact);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "warmbase_list",
    {
      description: "List opted-in contacts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return okResult(WarmBase.load(warmbasePath).listContacts());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "record_stop",
    {
      description: "Log a STOP for a number. It leaves the warm base.",
      inputSchema: {
        to: z.string().describe("Number in E.164 form."),
        keyword: z
          .string()
          .optional()
          .describe("Inbound keyword. Default is STOP."),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ to, keyword }) => {
      try {
        checkPhone(to, "to");
        const base = WarmBase.load(warmbasePath);
        const entry = base.recordStop(to, keyword ?? "STOP");
        base.save(warmbasePath);
        return okResult(entry);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_stops",
    {
      description: "List logged STOPs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return okResult(WarmBase.load(warmbasePath).listStops());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "a2p_checklist",
    {
      description: "Read the A2P 10DLC registration checklist.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(a2pChecklist()),
  );

  server.registerTool(
    "get_cost_report",
    {
      description: "Read the cost report for this session.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => okResult(getCostReport()),
  );

  return server;
}

export async function startMcp(deps: McpDeps = {}): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
