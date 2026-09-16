# dsh-plugin-auto-limit

Automatically **pause** a DeepSeek Harness prompt session when a Claude or Codex
subscription usage window (5-hour, weekly, or monthly) reaches 98%, and
automatically **resume** it when the window resets and quota is available again.

Usage is read from the subscriptions you have linked through
[`dsh-plugin-subscriptions`](https://github.com/V1ki/dsh-plugin-subscriptions).

## What it actually does to a turn

When a window is full, the plugin **holds the request instead of failing it**.

It listens on the `llm/stream` waterfall — the one point every model call passes
through — and awaits a per-provider gate before letting the call reach the
adapter. So at 98%:

- the request is **never sent**, and no tokens are spent;
- the turn **stays open** rather than erroring out;
- when the window resets, that **same turn continues on its own**.

Nothing needs re-prompting, and nothing is lost. This is the same shape
`dsh-plugin-subscriptions` already uses to wait out a disclosed 429 reset,
applied one step earlier — before the request goes out rather than after the
provider refuses it.

## Behavior that matters

**The gate is per provider.** A usage window belongs to a subscription, so
Claude sitting at 98% says nothing about Codex. Only the affected provider's
requests are held; the other subscription stays fully usable.

**Pooled accounts keep working.** With several accounts of one provider logged
in, the provider is paused only when *every* account is over the threshold —
because `dsh-plugin-subscriptions` can route around a full account, and pausing
while another still has quota would stop work that could have continued.

**A failed usage lookup never pauses and never resumes — but it says so.** An
endpoint that is down, 401ing, or rate-limiting its own lookups reports nothing
about quota. Guessing "full" would stop a healthy session; guessing "empty"
would release a parked turn into a still-closed window. The last known state is
held instead, behind a five-minute cooldown.

Crucially, when readings go stale the plugin **warns loudly** that limits are no
longer being enforced. Silent blindness here is what previously let a window run
from 98% to 100% with the gate wide open.

**The provider's own refusal is a backstop.** Polling can be starved; model
traffic cannot. A `RATE_LIMIT` / `QUOTA_EXCEEDED` / 429 on the actual stream
closes the gate immediately, regardless of what polling knows.

**The usage endpoints are polled sparingly, because they rate-limit
*themselves*.** Measured against the live Claude endpoint: it serves roughly one
lookup per minute, and the limiter is *progressive* — every hit inside a closed
window extends the next one, and `retry-after: 0` is not to be believed. A
six-call burst left it refusing for over two minutes. So the plugin polls at
most once per minute per provider, spends one call per *subscription* rather
than per login (several logins of one subscription report identical usage and
are detected and deduped), rotates across accounts so none is starved, and backs
off five minutes on refusal.

**Release is driven by a real reading, not by a local clock.** The reset instant
a provider discloses is an estimate it may revise, so the gate reopens when the
usage endpoint actually reports a below-threshold number. A window that reopens
early is picked up; one that slips does not release early.

**Polling is adaptive within that budget.** Every 5 minutes while open (usage
only moves when you make requests), tightening toward the disclosed reset while
paused, but never faster than the endpoint's ~1/minute allowance.

## Install

```bash
dsh plugin --profile web add file:$HOME/code/dsh-plugin-auto-limit
```

Then add the bundle to the profile's `package.json` under
`dsh.profile.bundles` (after `dsh-plugin-subscriptions`):

```json
"dsh-plugin-auto-limit"
```

## Configuration

Everything is optional; the defaults are the behavior described above. Override
from the profile's `cordis.patch.yml`:

```yaml
- id: auto-limit
  config:
    threshold: 98          # percent at or above which to pause
    providers: [claude, codex]
    pollIntervalMs: 300000        # while open (minimum 60000)
    pausedPollIntervalMs: 120000  # while paused (minimum 60000)
    maxHoldMs: 0           # 0 = wait as long as it takes
    enabled: true
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Set `false` to load the plugin but never gate anything. |
| `threshold` | `98` | Percent at or above which a window pauses its provider. |
| `providers` | `[claude, codex]` | Which subscriptions to meter. These are the two with usage endpoints. |
| `pollIntervalMs` | `300000` | Usage poll interval while every window is open (minimum 60000 — the endpoints refuse faster polling and extend their own lockout). |
| `pausedPollIntervalMs` | `120000` | Upper bound on the poll interval while paused; a near reset polls sooner, floored at 60s. |
| `maxHoldMs` | `0` | Escape hatch: cap how long one turn may be held, failing it after that. `0` waits indefinitely, which is the point of the plugin. |

## What gets logged

```
auto-limit: watching claude, codex at 98% (poll 120s, 30s while paused)
auto-limit: pausing claude — weekly window at 98.4% (threshold 98%). Requests are held until 9/14/2026, 7:00:00 AM (in 5h 12m).
auto-limit: holding a claude request — weekly window at 98.4%; waiting for reset at ...
auto-limit: resuming claude — quota available again; released 1 held request(s)
auto-limit: released a held claude request; continuing the turn.
```

## Notes and limits

- **Claude and Codex only.** Grok exposes no usage endpoint, and Copilot's is
  not a windowed quota, so neither can be metered. Configuring them is rejected
  at load rather than silently ignored.
- **Windows are read, not inferred.** Claude reports 5-hour and weekly (plus
  per-model weekly lanes such as Opus); Codex reports its windows with a
  duration, which is what this plugin classifies on — a 5-hour, weekly, or
  monthly lane is recognized by its reported length rather than by its slot,
  because the backend has been observed moving lanes between slots.
- **The token file is read, never written.** `dsh-plugin-subscriptions` owns
  `~/.dsh/plugins/subscriptions/auth.json`; this plugin only reads it, and does
  not refresh tokens. A usage lookup that 401s is treated as "no reading" and
  retried later, by which time the subscriptions plugin will have refreshed the
  session for its own traffic.
- The usage lookups themselves consume no rate-limit budget.

## Tests

```bash
npm test
```

72 tests cover the threshold decisions, both providers' payload shapes (modern
and legacy), the pooled-account and failure-handling rules, cancellation, and
the held-then-released turn.

`test/regression.test.js` pins the specific failure that let a real weekly
window run from 98% through 100%: two logins of one subscription burning two
lookups per cycle, a post-turn refresh firing every few seconds, and the
resulting permanent 429 turning "a failed lookup never pauses" into "never
pauses at all" — silently.
