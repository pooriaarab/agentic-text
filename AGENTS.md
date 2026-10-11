# agentic-text agent guide

Send texts to opted-in contacts over Twilio, Telnyx, or Plivo.

## Mental model

A warm contact goes in. A vendor receipt comes out. One core
serves all three faces, so each face returns the same shape.

## The three faces

- SDK: `import { dispatchText } from "agentic-text"`.
- CLI: `npx agentic-text send --to ... --from ... --text "..."`.
- MCP: `npx agentic-text mcp`, then call a tool below.

Keywords: sms, twilio, 10dlc, agentic-suite, claude-code,
codex, cli, mcp.

## MCP tools

| Tool | Use it for |
| --- | --- |
| send_text | Send one text. Pass dryRun false to send live. |
| warmbase_add | Add an opted-in contact with its source. |
| warmbase_list | List opted-in contacts. |
| record_stop | Log a STOP. The number leaves the base. |
| list_stops | List logged STOPs. |
| a2p_checklist | Read the A2P 10DLC checklist. |
| get_cost_report | Read session cost totals. |

## The loop

1. Discover the tools with `tools/list`.
2. Add the contact with `warmbase_add` and a real source.
3. Preview the send with `send_text` and dryRun true.
4. Run the live send when the preview looks right.
5. Read `get_cost_report` and state the cost.

## Rules

- Preview with dry run before each live send.
- Send to warm numbers only. Never invent a contact.
- Stop when a guard denies the call. State the reason.
- Never retry a denied call with changed text to dodge a guard.
- Log each STOP with `record_stop` before you send more.
- Report adapter errors as errors. Never present them as success.
- State the cost report before you claim the task is done.
