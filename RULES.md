# agentic-text rules

These rules bind every run of agentic-text. They also bind
agents that drive this pack over MCP.

1. Preview before you act. Run each send with dry run first.
2. Send to warm numbers only. Cold numbers stay out.
3. Respect guards. A denied call stays denied.
4. Honor STOP at once. A STOP blocks all later sends.
5. Report failures as failures. Adapters throw, and callers surface
   the error. No silent success follows a failed call.
6. Count the cost. Read the cost report before you close a task.
7. Keep quiet hours. The pack refuses sends inside the window.

Pack: Send texts to opted-in contacts over Twilio, Telnyx, or
Plivo. Keywords: sms, twilio, 10dlc, agentic-suite, claude-code,
codex, cli, mcp.
