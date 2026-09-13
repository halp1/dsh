# Fork notes

A personal fork of **[@kenz1117/dsh-ui-usage-billing](https://github.com/kenz1117/dsh-ui-usage-billing#readme)**
(MIT). Upstream is the canonical project and deserves the credit; this fork exists
only to carry one local default that upstream has no configuration seam for.

- **Upstream repo:** https://github.com/kenz1117/dsh-ui-usage-billing
- **Upstream README:** https://github.com/kenz1117/dsh-ui-usage-billing#readme
- **Forked at:** tag `v1.2.6` (commit `4acffb5`)
- **Fork version:** `1.2.6-fork.halp1.N` — the `-fork.halp1.N` suffix is what keeps
  semver ranges from ever pulling a newer upstream release over it.

## Why this fork exists

The dashboard's currency is plain, non-persisted React component state:

```ts
const [currency, setCurrency] = useState<CostCurrency>('cny')
```

It is not written to `localStorage` (the plugin persists ten other preferences —
`budget`, `card`, `float`, `livecost`, `perf`, `prices`, `sites`, … — but not this
one), and it is not exposed in `UsageBillingConfig`, so it cannot be set from
`cordis.patch.yml` or `settings.yaml`. Defaulting to USD therefore requires a code
change, which is the entire reason for the fork.

Language is **not** patched here — it is handled properly upstream. The plugin
registers both dictionaries (`ctx.locale.register(NS, { zh, en })`) and the host's
durable locale setting selects between them:

```yaml
# ~/.dsh/settings.yaml
locale:
  preference: en
```

## Divergence from upstream

| File | Change |
| --- | --- |
| `src/client/usage-billing-settings.ts` | **new**: persisted display-currency pref (`dsh.ui-usage-billing.currency` + `…currency-pref` event), default `'usd'` |
| `src/client/UsageBilling.tsx` | currency state loads/saves that pref; `currency` threaded into `UsageBillingTrigger` |
| `src/client/live-cost.tsx` | `LiveCostBar` + `LiveCostChip` follow the shared pref instead of hardcoded `'cny'` |
| `src/client/UsageBilling.module.css` | amount never shrinks or clips; label yields first; breakpoints `200/170` → `230/190` |

### Why it grew past one line

The first cut only flipped `BillingDashboard`'s `useState`. That left the sidebar
chip still showing `¥`, because **the billing UI is three independent React
trees**, not one:

| Surface | Component | Slot |
| --- | --- | --- |
| Sidebar chip | `UsageBillingTrigger` | `sidebar.footer.action` |
| Composer ticker | `LiveCostBar` | `conversation.composer.dock` |
| Toolbar chip | `LiveCostChip` | `conversation.input.right` |

The trigger never received `currency` as a prop and called bare
`formatMoney(x)` (which defaults to CNY); the two live-cost surfaces mount in
*separate slots* and cannot read the dashboard's state at all — upstream just
hardcoded `'cny'` in them. A prop could fix the trigger, but not the slot-mounted
ones, so the currency moved into a module-level persisted preference following
the existing `LIVE_COST_BAR_PREF_EVENT` pattern (localStorage for durability,
`CustomEvent` + `storage` for cross-tree and cross-tab sync).

Useful side effect: the currency choice now **survives a reload**, which it never
did upstream.

### The layout fix

Setting the host to `locale.preference: en` swapped short CJK labels for much
wider English ones (`当月` → `This month`, `今日 ¥452.8 · 本周` →
`Today $66.7 · This week`) inside a chip whose CSS was tuned for CJK widths. The
label and the amount shrank with equal priority, so the *amount* got clipped to
`54…` — the one thing the card exists to show. Fixed by making `.triggerMetric`
non-shrinking (`flex: 0 0 auto; overflow: visible`) and `.triggerLabel` yield
first (`flex: 0 1 auto`), then widening the container-query breakpoints so
English degrades cleanly instead of leaving half-words like `This w…`.

Plus fork identity in `package.json`: the `version` suffix, `private: true`,
`repository` pointed at the fork, `homepage` kept pointing at upstream's README,
and a `fork` metadata block recording the upstream provenance.

The package **name is intentionally unchanged** (`@kenz1117/dsh-ui-usage-billing`)
so the profile's `dsh.profile.bundles` list and every internal import keep
resolving without edits.

`private: true` is set so this fork can never be accidentally `npm publish`ed
into upstream's namespace.

## Pulling in upstream changes

```sh
git fetch upstream
git merge upstream/main          # or: git merge v1.2.7
pnpm install --no-frozen-lockfile
pnpm run build                   # lib/*.js is tracked — rebuild before committing
git commit -am 'merge upstream'
```

Bump the `-fork.halp1.N` counter in `package.json` after a merge, then reinstall
in the profile (see below). If the merge ever conflicts, it will be on that single
`useState` line — keep `'usd'`.

## Build artifacts are committed

`lib/client.js`, `lib/index.js`, and `lib/invariant.js` are tracked in git (only
the source maps and `.d.ts.map` files are ignored). The profile installs this fork
straight from git, so **an un-rebuilt `lib/` ships stale code**. Always run
`pnpm run build` before committing.

## Installing into the DSH profile

Installed into `~/.dsh/profiles/web` pinned to an exact git commit, so `pnpm
update` cannot move it:

```sh
dsh plugin --profile web add 'github:halp1/dsh-ui-usage-billing-fork#<commit-sha>'
```

Pinning to a commit SHA rather than a branch means even a future push to the fork
will not change what the profile resolves until you re-pin deliberately.

## Upstream test suite

`pnpm test` reports 9 failing test files / 64 failing tests **on pristine upstream
`v1.2.6` as well** — a pre-existing jsdom/`localStorage` environment issue, not
caused by this fork. Verified by running the same suite on an unmodified clone.
