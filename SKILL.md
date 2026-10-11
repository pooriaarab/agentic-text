---
name: agentic-text
description: Send texts to opted-in contacts over Twilio, Telnyx, or Plivo. Keywords: sms, twilio, 10dlc, agentic-suite, claude-code, codex, cli, mcp.
---

# agentic-text

Send texts to opted-in contacts over Twilio, Telnyx, or Plivo.

## Use the SDK

```js
import { dispatchText, createSmsAdapter } from "agentic-text";

const adapter = createSmsAdapter("twilio", {
  to: "+15551234567",
  from: "+15557654321",
});
await dispatchText("Doors open at 9.", { adapter, dryRun: true });
```

## Use the CLI

```sh
agentic-text send --to +15551234567 --from +15557654321 --text "Doors open at 9."
agentic-text send --to +15551234567 --from +15557654321 --text "Doors open at 9." --live
```

## Use the MCP server

Start the server with `agentic-text mcp`. Call `send_text`
for sends, `warmbase_add` for contacts, `record_stop` for
STOPs, `a2p_checklist` for the checklist, `get_cost_report`
for costs.

## Rules

- Preview each send with dry run first.
- Send to warm numbers only.
- Report guard denials and adapter errors as failures.
- Read the cost report at the end.
