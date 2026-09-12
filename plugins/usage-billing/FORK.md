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

Exactly one line of source, deliberately kept minimal so merges stay trivial:

| File | Change |
| --- | --- |
| `src/client/UsageBilling.tsx` | currency default `'cny'` → `'usd'` |

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
