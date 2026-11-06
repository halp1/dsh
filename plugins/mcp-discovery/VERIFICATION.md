# Verification

## Compatibility fix verified 2026-11-05

Installed local version `0.1.1` into the existing web profile running DSH `0.2.2-rc.1`, then disabled and re-enabled only the discovery row to reload it. No host restart or frontend rebuild was needed. No commit was made.

The original failure was a hard dependency on the removed `ToolRuntime.modeFor()` method. The prompt assembly waterfall also no longer controls provider-owned tool declarations. The fix recognizes legacy mode checks when available and filters the completed public assembly result with a lifecycle-owned wrapper, leaving native executor selection and execution untouched.

- Syntax check passed and all 22 installed-runtime integration tests passed.
- Tests cover provider-owned declarations, step admission disposal, unsupported scoped executors, and disposal followed by reinstall in addition to the existing selection and policy checks.
- Live status reported 250 available managed tools, 851,118 available schema bytes, and zero selected tools.
- Live search returned a bounded Gmail catalog result without schemas.
- Live selection added exactly one Gmail search tool, reporting 1,341 selected schema bytes.
- Live selection was cleared back to zero tools and zero selected schema bytes.
- No underlying MCP operation was executed.

The package dry-run encountered an npm cache permission error. The supported DSH local installation succeeded. It also reported an existing unrelated incompatible computer-use package. No compatibility exemption was granted.

## Original verification 2026-10-20

## Live installation

Installed `dsh-plugin-mcp-discovery@0.1.0` with the supported DSH plugin command into the existing web profile. The package bundle loaded live; no new web server or DSH package patch was used. Added an explicit `mcp-discovery` configuration row to the web profile patch for `rea` and `gworkspace`, limit 16.

The live session successfully called the plugin's actual `search_mcp_tools` and `select_mcp_tools` controls. These are not results from a separate mock host.

Measured catalog sizes (sum of serialized UTF-8 model-facing declarations, excluding array punctuation):

| Server | Tools | Schema bytes hidden in a fresh chat |
| --- | ---: | ---: |
| REA | 207 | 774,814 |
| Google Workspace | 43 | 72,146 |
| Total managed | 250 | 846,960 |

The two discovery tool declarations together use 1,182 bytes. Replacing the managed catalog with those controls reduces this portion of schema bytes by 99.86%. This is **not** a claim about exact tokens or the percentage reduction of the entire request; unrelated tools, system instructions, and conversation history still count.

Live checks, without executing an underlying MCP operation:

- Initial status: zero selected, 250 available, 846,960 available schema bytes.
- Searched Google Workspace for `gmail search messages`; received short results, no argument schemas.
- Added only `mcp__gworkspace__search_gmail_messages`: 1,226 selected schema bytes.
- Searched REA for `decompile native function`; received a bounded result page.
- Replaced the selection with only `mcp__rea__analyze_function`: 782 selected schema bytes.
- Cleared the selection with `replace: []`: zero selected schema bytes again.
- No email was searched/read/sent, Drive document changed, REA target analyzed, credential modified, or MCP operation executed as part of these checks.

## Automated checks

`node --check src/index.js`, `npm test`, and `npm pack --dry-run` passed. All 21 tests run against the installed DSH public runtime APIs, using synthetic tools.

Coverage: cold schemas/guidance filtering; bounded search/pagination; exact schema activation; original validation/execution; atomic changes and limits; session and fork isolation; native restrictions and approval denial; disconnect/catalog replacement; cancellation; post-policy blocking and canonical-value replacement; metadata resume; compaction replacement non-resurrection; configuration changes; native image projection; scoped discovery-control denial; plugin restart/disposal; provider history projection; byte accounting.

An independent read-only review checked permission, cancellation and persistence paths. Findings about result identity, post-policy metadata, pruning copies, and superseded selection snapshots were corrected and regression-tested.

### Persistence implementation adjustment

The approved design proposed a new non-message session event. The installed runtime has no public append API for marking an external event ignorable, and its persistence reader rejects unknown non-ignorable event types. Instead, this implementation uses the existing tool result's opaque presentation metadata. It stores only a version and selected names, not schemas, creates no unknown session events, and adds no selection-state text beyond the normal compact result. Same-session restore and compaction/reload behavior are tested.

## Verification limits / existing warnings

Visual GUI verification was not completed. `dsh_browser_visited` reported that the registered Electron browser provider is unavailable because no spawnable Electron binary was found. No Electron install or unrelated browser repair was attempted. The existing live DSH session continued working, loaded the new tools, and successfully performed the live checks above.

The plugin installer also reported an existing incompatible `@anionex/dsh-computer-use@0.3.2` dependency. The profile already disables `computer-use`; this work did not grant an exemption, enable it, or change that dependency declaration.

PTC/hybrid presentation is intentionally unsupported and produces a clear diagnostic for managed capabilities. Existing conversation content is not erased; use a fresh chat for clean context savings. Rollback instructions are in README.md.
