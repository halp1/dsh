# dsh-plugin-schedule-send

Send a composer message later. Shift click or right click the Send button and
pick a time:

- **In**: an amount in minutes, hours, or days, or a quick pick (30 min, 1 hr,
  3 hr, 1 day)
- **At**: Today, Tomorrow, one of the next few weekdays, or any date, plus a
  time of day

The popover shows the resolved time ("Tomorrow, 9:00 AM" and "in 19 hr")
before you commit. Scheduled messages sit in a row above the composer with
**Send now** and **Cancel**. Cancel puts the text back in the draft.

At the chosen time the message arrives as an ordinary user message, exactly as
if you had pressed Send, queued behind a running turn if there is one. The
host owns the timer, so the browser can be closed.

## Install

```bash
pnpm --filter dsh-plugin-schedule-send run build
dsh plugin --profile web add file:/path/to/plugins/schedule-send
```

Reload the page. After rebuilding, run the same `add` command again because
pnpm installs `file:` dependencies as a copy.

## Limits

- Text only. Drafts with attachments or a leading `/` command cannot be
  scheduled.
- Times are in the browser's time zone, which is stored with the message.
- Up to a year ahead. One-shot only. Use the built-in schedule tasks for
  recurring prompts.
- A message for a session that no longer exists is marked failed. Other
  delivery errors retry with backoff (1, 2, 4, 8 minutes) and then fail.
  Failed rows offer **Retry** and **Discard**.

## How it works

**Node half.** Keeps the queue in
`<$DSH_HOME or ~/.dsh>/plugins/schedule-send/queue.json` (override with the
`queueFile` config) and arms one timer for the next due item. Delivery calls
the Session Controller's `prompt` with `mode: 'queue'` and the item id as the
`requestId`. The host deduplicates that id, so a crash between delivery and
removal cannot send twice. Items that came due while the host was down are
sent on startup.

Routes on the authenticated `/api` channel:

- `GET  /api/dsh-schedule-send.list?sessionId=`
- `POST /api/dsh-schedule-send.create` `{ sessionId, text, sendAt, clientTimeZone? }`
- `POST /api/dsh-schedule-send.cancel` `{ id }`
- `POST /api/dsh-schedule-send.send-now` `{ id }`
- `POST /api/dsh-schedule-send.retry` `{ id }`

**Browser half.** The Send button has no slot, so the plugin renders a hidden
anchor in `conversation.input.right`, which shares Send's toolbar group. A
capture-phase document listener catches shift click and right click on that
group's `button[aria-busy]` (the primary action) and stops the event before
React sees it. Plain clicks are never touched. If a host update moves the
button, the hook finds nothing and Send keeps working as before. The pending
list is a `conversation.input.dock` entry.

## Development

```bash
pnpm test     # node:test via tsx, jsdom for the Send hook
pnpm build    # tsc -b && tsdown
```

## License

MIT
