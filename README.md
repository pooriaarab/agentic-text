# agentic-text

[![npm version](https://img.shields.io/npm/v/agentic-text)](https://www.npmjs.com/package/agentic-text) [![Downloads/month](https://img.shields.io/npm/dm/agentic-text)](https://www.npmjs.com/package/agentic-text) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

agentic-text is an open-source TypeScript SMS wrapper for Twilio, Telnyx, and Plivo, with contact opt-in records and manual STOP controls.

## Install

```sh
npm install agentic-text
```

Requires Node.js 18 or later. Includes TypeScript declarations and three runtime dependencies.

## Preview your first text

Save this as `preview.mjs`, then run `node preview.mjs`:

```js
import { dispatchText, DryRunSmsAdapter, getCostReport } from "agentic-text";
const preview = await dispatchText("Preview only", {
  adapter: new DryRunSmsAdapter(), dryRun: true
});
console.log(preview);
console.log(getCostReport());
```

Expect a result with `dryRun: true` and zero recorded dispatches. This example needs no credentials or contact data.
It sends no SMS. Direct library calls require callers to apply contact checks and guards explicitly.

## Features and coverage

- Store contacts with an opt-in source and timestamp in a local JSON file.
- Record STOP entries; `ensureWarm` blocks stopped or unlisted numbers.
- Apply UTC quiet hours and optional dispatch caps in the CLI; MCP supports injected guards.
- Add a brand prefix and STOP footer with CLI `--brand` or the `withOptOutFooter` helper.
- Classify inbound keywords and validate application-to-person ten-digit long code (A2P 10DLC) campaign fields with library helpers.

| Integration | SMS adapter | Environment variables | Verification |
| --- | --- | --- | --- |
| Twilio | Implemented | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Mocked HTTP; no live credential check |
| Telnyx | Implemented | `TELNYX_API_KEY` | Mocked HTTP; no live credential check |
| Plivo | Implemented | `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN` | Mocked HTTP; no live credential check |

Three vendor adapters and one dry-run adapter exist. Export credentials before live calls; the package does not load `.env` files.
CLI vendor selection follows Twilio, Telnyx, then Plivo environment keys; `--vendor` overrides it. MCP defaults to Twilio.

## Runtime surfaces

CLI commands: `send`, `warmbase add|list`, `stops add|list`, `a2p`, `costs`, and `mcp`; flags include `--help` and `--version`.
Use `warmbase add --to <real-opted-in-number> --source <opt-in-source>` before sending.
`send` requires `--to`, `--from`, and `--text` or `--file`. Preview first; add `--live` for a vendor call.
Optional send flags include `--vendor`, `--brand`, `--warmbase`, `--cap`, `--quiet-start`, `--quiet-end`, and `--dry-run`.
`warmbase add` accepts `--name`; `stops add` accepts `--keyword`.
The default contact file is `~/.agentic-text/warmbase.json`; override it with `AGENTIC_TEXT_WARMBASE` or CLI `--warmbase`.
Record each received STOP with `stops add --to <number>`. The number leaves the contact list and remains blocked.

Start the Model Context Protocol (MCP) server with `npx agentic-text mcp` or `npx agentic-text-mcp`.
Its seven tools are `send_text`, `warmbase_add`, `warmbase_list`, `record_stop`, `list_stops`, `a2p_checklist`, and `get_cost_report`.
`send_text` previews by default; `dryRun: false` requests a live send after contact and guard checks.
The self-hosted Worker source exposes `GET /health` and `POST /preview`; it never sends SMS or reads the contact file.

## Behavior limits

CLI and MCP quiet hours default to 01:00–13:00 UTC. These checks can also block previews.
The package records supplied opt-in evidence; it cannot verify consent or guarantee regulatory compliance.
Direct adapters bypass contact checks, quiet hours, and footer helpers. Library callers must use `ensureWarm` and configured guards.
STOP recording is manual; there is no inbound webhook receiver. Adding a contact again does not clear its STOP entry.
A successful HTTP response produces a receipt, not proof of handset delivery; missing vendor IDs receive generated IDs.
Requests default to a ten-second timeout, with no automatic retry, failover, or delivery-status polling.
Contact storage uses synchronous JSON writes without file locking. Cost reports are process-local usage, not vendor invoices.
`a2p` prints guidance and key-presence flags; it does not register campaigns. There is no managed SMS service.
Version 0.1.x interfaces can change. No public case studies are published in this repository.

## Links and license

[Package](https://www.npmjs.com/package/agentic-text) · [Twilio](https://www.twilio.com/) · [Telnyx](https://telnyx.com/) · [Plivo](https://www.plivo.com/)

MIT license.
