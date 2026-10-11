# Agentic text

Send texts to opted-in contacts over Twilio, Telnyx, or Plivo.

The pack sends to warm numbers only. It previews each send
before it sends. It logs STOP replies. It honors quiet hours.

## Usecases

- Remind patients of visits. A clinic texts reminders to
patients who opted in at booking.
- Tell buyers an order is ready. A shop texts pickup notes to
buyers who left a number at checkout.
- Warn members of a delay. A club texts delay notes to members
on the trip list.

## Install

```sh
npm install -g agentic-text
```

Set one vendor key:

```sh
export TWILIO_ACCOUNT_SID=ACxxx
export TWILIO_AUTH_TOKEN=xxx
```

Telnyx uses `TELNYX_API_KEY`. Plivo uses `PLIVO_AUTH_ID` plus
`PLIVO_AUTH_TOKEN`. The pack picks the vendor from the keys it
sees. Pass `--vendor` to fix one.

## Quick start

Add a contact with its opt-in source:

```sh
agentic-text warmbase add --to +15551234567 --source "web form"
```

Preview a send. Preview is the default. It needs no keys and it
spends nothing:

```sh
agentic-text send --to +15551234567 --from +15557654321 \
  --text "Doors open at 9." --brand "Acme"
```

Send for real:

```sh
agentic-text send --to +15551234567 --from +15557654321 \
  --text "Doors open at 9." --brand "Acme" --live
```

Log a STOP:

```sh
agentic-text stops add --to +15551234567
```

The number leaves the warm base at once. Later sends to it fail.

## Rules the pack enforces

- Warm base only. Cold numbers fail before any vendor call.
- Dry run first. Each send previews unless you pass `--live`.
- STOP wins. A logged STOP blocks the number in all faces.
- Quiet hours hold. The pack refuses sends from 01:00 to 13:00
UTC by default. Pass `--quiet-start` and `--quiet-end` to set
your own window.
- Vendors throw. A failed vendor call raises an error. It never
returns fake success.

## A2P 10DLC

US carriers filter unregistered business texts. Register the
brand and each campaign in the vendor console before you send
volume. Print the checklist:

```sh
agentic-text a2p
```

## Use the library

```js
import { WarmBase, ensureWarm, dispatchText } from "agentic-text";
import { createSmsAdapter } from "agentic-text";

const base = WarmBase.load("/path/to/warmbase.json");
ensureWarm("+15551234567", base);
const adapter = createSmsAdapter("twilio", {
  to: "+15551234567",
  from: "+15557654321",
});
await dispatchText("Doors open at 9.", { adapter, dryRun: true });
```

## Use the MCP server

```sh
agentic-text mcp
```

Tools: `send_text`, `warmbase_add`, `warmbase_list`,
`record_stop`, `list_stops`, `a2p_checklist`, `get_cost_report`.
`send_text` previews by default. Pass `dryRun: false` to send.

## Commands

- `send`: send one text. See Quick start for flags.
- `warmbase add|list`: add or list opted-in contacts.
- `stops add|list`: log or list STOPs.
- `a2p`: print the A2P 10DLC checklist and key presence.
- `costs`: print the cost report as JSON.
- `mcp`: start the MCP server on stdio.

## Config

- `AGENTIC_TEXT_WARMBASE`: warm base file path. Default is
`~/.agentic-text/warmbase.json`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`: Twilio keys.
- `TELNYX_API_KEY`: Telnyx key.
- `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`: Plivo keys.

`a2p` reports key presence as true or false. It never prints a
value.

## License

MIT.
