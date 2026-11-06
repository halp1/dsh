# AGENTS.md

Guidance for working on `dsh-plugin-usage-billing`, the usage and cost dashboard plugin for DeepSeek Harness. It lives in the dsh-plugins monorepo at `plugins/usage-billing`.

## Commands

- Build: `pnpm run build` (writes `lib/`, which is not committed)
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Bundle size: `pnpm run size` after a build

## Billing rules

- **Pricing history is never rewritten.** Every historical event is priced by the official rule in effect when it happened. Official price changes are appended as new dated rules (see the timeline in `src/client/pricing.ts`). Never reprice history with the current rule.
- **Month-to-date forecast** (`src/client/domain/forecast.ts`): month-to-date spend plus the last 7 calendar days' pace times the days left in the month. Only extrapolate days that have not happened yet. Do not go back to averaging over recorded days and multiplying by the month length, which inflates sparsely used months.
- **Catalog growth and price corrections are separate changes.** Adding models must not touch the prices of existing entries. Overseas vendors use native USD prices from models.dev. Domestic vendors prefer the official CNY price and, when converted from USD, note the conversion source in the entry comment.
- **Catalog guard tests** in `tests/pricing.spec.ts` lock three invariants: catalog keys are unique, normalized keys do not collide (the normalized index is first match wins), and aliases point at existing entries. Run them after any catalog change.

## Host integration

- Host capabilities use type-only imports plus `ctx.get()` feature detection with graceful degradation. Examples: session navigation (`src/client/session-navigation.ts`), the `/usage` command (`src/client/usage-command.ts`) and the task queue (`src/task-queue.ts`). Do not declare these as injected dependencies, because an older host without the service would hang startup waiting for it.
- Do not add new `@deepseek-ai/*` modules to `PLATFORM_MODULES` in `scripts/clientBundle.ts`. A module listed there stays a runtime `require()` and throws on hosts that cannot answer it. `scripts/check-clientbundle-sync.mjs` compares the list with the host `platform.ts` when a host checkout is available.
- The client bundle is a single closure factory with no code splitting, so new code adds directly to its size.

## UI rules

- **Panel shrink guard**: `.dashboardBody` and `.tabPanel` are column flex containers, so their direct children must set `flex-shrink: 0`. Otherwise tall cards get squashed instead of the container scrolling. jsdom cannot test layout, so lint guard 7 enforces it.
- The rate table header must stay sticky: `.ubTablewrapPricing` needs a `max-height` and its header cells need `position: sticky`, `top: 0` and an opaque background (lint guard 8).
- Dashboard tabs show names only, no status badges.

## Compatibility

- Do not change browser localStorage keys (`dsh.ui-usage-billing.*`), settings namespaces (`ui-usage-billing.*`), ledger file names, HTTP routes or the `[usage-billing]` log prefix. Existing user data depends on them.

## Tests

- Client tests use `tests/bind-snapshot-selector.ts` in place of the official test runtime, which cannot be installed.
- Lock contention tests use an always-alive pid.
- `pnpm test:e2e` runs HTTP contract specs in `tests/api-contract/` against a running host. Run it when changing endpoint paths or fields.
