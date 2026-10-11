import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { createMcpServer } from "./mcp.js";
import { WarmBase } from "./warmbase.js";

const TO = "+15551234567";

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] })
    .content;
  return content[0].text;
}

async function linked(path: string): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const base = new WarmBase();
  base.add({ to: TO, source: "web form" });
  base.save(path);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ warmbasePath: path });
  await server.connect(serverTransport);
  const client = new Client({ name: "probe", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
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

describe("mcp server", () => {
  test("serves seven tools over a client link", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((tool) => tool.name).sort();
        expect(names).toEqual([
          "a2p_checklist",
          "get_cost_report",
          "list_stops",
          "record_stop",
          "send_text",
          "warmbase_add",
          "warmbase_list",
        ]);
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("send_text previews by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        const preview = await client.callTool({
          name: "send_text",
          arguments: { to: TO, text: "hi" },
        });
        expect(JSON.parse(textOf(preview))).toMatchObject({ dryRun: true });
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("send_text refuses cold numbers with a tool error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        const result = await client.callTool({
          name: "send_text",
          arguments: { to: "+15550000000", text: "hi" },
        });
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(textOf(result)).toContain("warm base");
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("record_stop blocks later sends", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        await client.callTool({
          name: "record_stop",
          arguments: { to: TO },
        });
        const result = await client.callTool({
          name: "send_text",
          arguments: { to: TO, text: "hi" },
        });
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(textOf(result)).toContain("STOP");
        const stops = await client.callTool({
          name: "list_stops",
          arguments: {},
        });
        expect(JSON.parse(textOf(stops))).toHaveLength(1);
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("warmbase_add then warmbase_list round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        await client.callTool({
          name: "warmbase_add",
          arguments: { to: "+15550000001", source: "event booth" },
        });
        const list = await client.callTool({
          name: "warmbase_list",
          arguments: {},
        });
        const contacts = JSON.parse(textOf(list)) as { to: string }[];
        expect(contacts.map((c) => c.to).sort()).toEqual([
          "+15550000001",
          TO,
        ]);
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a2p_checklist and cost report answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-"));
    try {
      const { client, close } = await linked(join(dir, "warmbase.json"));
      try {
        const list = await client.callTool({
          name: "a2p_checklist",
          arguments: {},
        });
        expect(JSON.parse(textOf(list))).toHaveProperty("steps");
        const report = await client.callTool({
          name: "get_cost_report",
          arguments: {},
        });
        expect(JSON.parse(textOf(report))).toHaveProperty("dispatches");
      } finally {
        await close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
