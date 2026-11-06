# dsh-plugin-usage-billing

A DeepSeek Harness plugin that tracks model spend. It aggregates real usage from persisted session logs, prices it with a time-aware multi-provider rate catalog, and shows the result in a sidebar entry plus a full dashboard.

This package lives in the dsh-plugins monorepo at `plugins/usage-billing`.

## Features

- **Real usage, durable ledger**: usage is folded incrementally from session logs into a ledger under the harness home (`DSH_HOME`, falling back to `~/.dsh`). Nothing is fabricated: an empty snapshot shows until real data arrives, and deleting a session does not erase recorded usage.
- **Time-based pricing**: live models.dev prices, a built-in catalog of about 240 models across 25 vendors, and user-defined prices that can be bound per relay origin. Peak and off-peak prices are segmented by official change dates, so later price changes never rewrite old bills.
- **Peak and off-peak awareness**: the billing channel follows the current session's model (DeepSeek time-of-day pricing, Zhipu Coding Plan credit windows), with alerts before each tier switch.
- **Subscriptions and balances**: Coding Plan and Token Plan quotas, official provider balances, relay rolling quotas (New API, Sub2API), self-declared endpoints, and daily balance-delta reconciliation against the local ledger. See [docs/adapters.md](docs/adapters.md) for every channel.
- **Dashboard**: eight sections (Overview, Queue, Billing, Usage, Trends, Agents, Rates, Settings) with budgets, heatmaps, per-model and per-session drill-down, an agent tree with chain totals, TTFT and generation speed, and CSV or JSON export. The `/usage` command opens it from a conversation.
- **Off-peak queue**: queue prompts to run during off-peak hours on the built-in `deepseek-official` route.
- **Read-only by default**: no system prompt injection. The optional `usage_stats` tool is off until the user enables it, and it only reads this plugin's aggregates.

## How it works

- **Server** (`src/index.ts`): registers loopback-only HTTP endpoints under `/api/billing/` for usage, pricing, balances, subscriptions, relays and the task queue. Optional host services such as `sessionController` are probed with `ctx.get()` so a missing capability never blocks the host.
- **Browser** (`src/client/`): renders the sidebar entry and dashboard from those endpoints.

Cost per call:

```
cost = (missInput * p_input + cacheHit * p_cacheHit + output * p_output) / 1e6
```

Prices are stored in each model's native currency and USD models convert at the live rate. The month-to-date forecast is month-to-date spend plus the last 7 calendar days' pace times the days left in the month.

To add a model, append an entry to `BUILTIN_MODEL_CATALOG` in `src/builtin-catalog.ts` (aliases live in `BUILTIN_MODEL_KEY_ALIASES` in the same file).

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `statsPath` | unset | Fallback `.dsh-usage-stats.json` used when `sessionPersistence` is unavailable |
| `ledgerPath` | `<harness home>/.dsh-usage-ledger.json` | Durable usage ledger (folded metrics only) |
| `taskQueuePath` | `<harness home>/.dsh-usage-task-queue.json` | Off-peak queue storage |
| `reconcilePath` | `<harness home>/.dsh-usage-reconcile.json` | Balance-delta reconciliation baseline |
| `balanceApiKeyEnv` | `DEEPSEEK_API_KEY` | Fallback credential for the DeepSeek balance query |
| `subscriptionProviders` | built-in list | Subscription provider ids (tokens counted, cost 0). Replaces the built-in list |
| `subscriptionPlans` | auto-detect | Subscription quota adapter whitelist |
| `declaredEndpoints` | unset | Self-declared balance or quota endpoints for providers not in the built-in table |
| `routeAliases` | unset | Old route name to current route, for renamed or deleted routes |
| `modelKeyAliases` | unset | Log model id to catalog key, for uncatalogued ids |
| `monthlyBudget` | unset | Default monthly budget (CNY) |
| `lowBalanceThreshold` | `50` | Low-balance alert threshold (CNY) |
| `trustedHosts` | unset | Extra host names accepted by the Host header check behind a reverse proxy |
| `searchCallEstimateCny` | `0.02` | Per-call estimate for web search requests, 0 disables it |

## Development

Requires Node.js `^22.19.0 || >=24.0.0` and pnpm.

```sh
pnpm install
pnpm run build   # tsc -b and tsdown, writes lib/
pnpm test        # vitest with jsdom
pnpm run lint    # repo guards (types, logging, empty catch, CSS parity, fonts, layout)
pnpm run size    # client bundle size guard, run after a build
```

`lib/` is build output and is not committed. `pnpm test:e2e` runs the HTTP contract specs in `tests/api-contract/` against a running local host (set `PLAYWRIGHT_BASE_URL` to choose it).

## License

[MIT](LICENSE)
