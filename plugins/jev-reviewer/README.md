# dsh-plugin-jev-reviewer

Jev reviews individual sandbox escalation requests in DSH `read-only` and `workspace-write` sessions. It can grant the exact operation once, reject it, or leave it waiting for DSH's existing human approval prompt.

**This is an opt-in probabilistic permission reviewer. It is not a security sandbox or a guarantee that an operation is safe.** Installing a Host plugin executes trusted code in the DSH process. Review this package before enabling it.

## Requirements

- DSH `0.2.2-rc.1`, with its approval, tools, sandbox policy, working directory, and session query services mounted
- Node.js 24.9 or newer
- A TypeSafe API key saved in **Settings > Jev reviewer**, or `TYPESAFE_API_KEY` in the DSH Host process environment
- An existing terminal human answerer, such as DSH Web or its interactive CLI adapter

The SDK is pinned to `@typesafe-ai/sdk` 0.7.0. The default model is `jev-1.14.0`. Tests use mocked transport, with no live Jev requests.

## Install and enable

Installation changes your profile and enables the bundle. Do it only after reviewing the data disclosure and policy below.

1. In DSH's **Plugins** page, install this local repository by its absolute directory path. The equivalent `plugin_manager` request is shown below. Replace the path with your checkout.
2. Open **Settings > Jev reviewer**, enter your TypeSafe API key in the masked field, and choose **Save key**. The saved key takes effect on the next automated review without restarting DSH. Alternatively, set `TYPESAFE_API_KEY` in the Host environment before launching DSH.
3. Keep the existing human approval adapter enabled. Check the manager's application result. If it reports restart-required, restart DSH yourself. If the Settings page is not yet visible after installing an update, refresh the browser window.

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/dsh-plugin-jev-reviewer"
}
```

No publication, global npm installation, or replacement DSH server is needed. The bundle registers one Host plugin entry, `jev-reviewer`. Its middleware prepends to `approval/request`, before a normal terminal answerer. Other policy middleware can still short-circuit or change ordering. Do not combine it with an answerer that unconditionally grants requests or another automatic reviewer without reviewing that composition.

To disable it, turn off the `jev-reviewer` entry or the entire bundle in Plugins. Disablement takes effect when DSH applies the change, or after restart when HMR is unavailable. In-progress Jev reviews are cancelled on actual unload. A human question already handed to the existing adapter remains owned by that adapter.

## API key in Settings

Open **Settings > Jev reviewer** to save or replace the key. This field is write-only: DSH returns only a presence marker, never the saved value. Successful saves clear the input. Failed or stale saves preserve your draft and show a generic error without echoing it. **Reset key** removes the profile override and restores an inherited key, or the environment fallback when none is configured.

A saved key takes precedence over `TYPESAFE_API_KEY`. Changes apply to new reviews immediately through DSH's live configuration reference. The SDK is only called from the Host, not the browser. No credential is stored in browser local/session storage or included in model state or reviewer logs.

DSH persists this setting in the profile configuration file as plain text. The secret role masks and redacts reads but does not encrypt the file. Any authenticated browser permitted to edit Host Settings can replace it. Protect your profile directory and backups. Use the environment fallback instead if profile-file persistence is unsuitable. Do not paste the key into chat or tool arguments.

## Configuration

The following is a profile patch override after the bundle is installed. The optional `apiKey` secret is managed separately through Settings. Other fields remain configuration-file options. Unknown fields and invalid values reject plugin startup.

```yaml
- id: jev-reviewer
  name: dsh-plugin-jev-reviewer
  config:
    enabled: true
    model: jev-1.14.0
    timeoutMs: 10000
    maxStateBytes: 65536
    allowProbability: 0.99
    rejectProbability: 0.99
    minConfidence: 0.90
```

`timeoutMs` is the total automated review budget, including context construction and service work. It does not limit human waiting. `maxStateBytes` bounds the complete UTF-8 JSON state, not a truncated excerpt. The maximum configurable state size is 1 MiB. Probability and confidence settings must be finite numbers between zero and one. Lowering them weakens the automatic-decision gate. Defaults are conservative starting thresholds, not a calibrated false-approval rate.

The API origin is fixed to `https://api.typesafe.ai`. The plugin does not honor `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, or `TYPESAFE_LOG_LEVEL`. SDK retries are disabled and SDK logging is explicitly off, including when the Host environment requests debug output. Missing credentials retain human approval rather than granting anything.

## Decision policy

Two Choice judgments run in one SDK request: an action and an effect category. Code requires both judgments to agree and validates their complete probability distributions, confidences, and exact model identity.

- **Allow once**: `allow` plus `low-risk`, with both selected probabilities meeting `allowProbability` and both confidences meeting `minConfidence`. Suitable candidates are clearly bounded task-related edits or understood low-risk tests and builds, including from read-only mode.
- **Reject**: `reject` plus `prohibited`, meeting the rejection and confidence thresholds. This is reserved for clear user or policy violations, credential theft, exfiltration, or bypass of required safeguards.
- **Human**: all other combinations, uncertainty, conflicting judgments, errors, timeouts, malformed responses, missing credentials, sensitive or oversized state, unsupported context, or insufficient probability/confidence.

Pre-existing data deletion, history rewriting, publishing or sending, production operations, system/security changes, opaque scripts/programs, uncertain targets, and privileged or external writes are human-required. Merely saying that a command is needed for the task is not enough. The model's justification, assistant text, and tool output cannot grant authority. User-invoked skills and project instructions constrain the action. They do not expand human authorization.

A human fallback calls the existing approval waterfall continuation exactly once. The human may approve or reject. No answerer or a failing answerer remains fail-closed through DSH. Approval policy `never` takes precedence, including if it changes while Jev is pending.

There is no allow-always mode, remembered permission, approval cache, session mode change, or approval-policy change. A new escalation is a new request. Machine rejections do not offer a second human decision for the same call. Current DSH may describe that rejection using its native wording that attributes it to the user.

## Eligibility and exact retry evidence

The reviewer correlates the live Agent, call ID, opaque execution token, tool definition, complete immutable arguments, actual current directory, workspace policy, and full canonical escalation reason. A generic pre-execute approval is not eligible, even if it imitates that reason. Ambiguous live call IDs go to a human.

Recognized names are `bash`, `pwsh`, `write`, `edit`, `str_replace_editor`, and `run_code`. Recognition alone is not permission. The actual current tool schema and runtime evidence must be available. Parent-linked inner PTC calls use the same tool pipeline boundary. Opaque `run_code` programs generally need human review, and transport-only calls without an inspectable schema or structured denial remain human-only. Plugin-management and unknown-tool requests are untouched.

Automatic review additionally requires a matching sandbox denial observed by this plugin earlier in the **same turn**, under the same mode, roots, directory, and operation arguments. Only trusted final execution facts qualify: structured process sandbox metadata or the filesystem `FS_SANDBOX_DENIED` error identity. A denial string printed by a command does not qualify. Command presentation text and the escalation fields are excluded from operation identity, but timeouts, background flags, paths, code, and all other operation parameters are bound.

Each refusal is consumed by at most one retry. Restarting, installing the plugin after the refusal, background-process results without structured sandbox facts, changed arguments, a new turn, or changed policy can therefore require a human. The bounded denial journal stores hashes and turn epochs, not raw command text or persistent grants.

Before an automatic decision, the middleware rechecks execution lifetime, current mode and roots, directory, tool definition, and instruction-change generation. Caller cancellation, session disposal, or plugin unload prevents a late grant even if the remote transport ignores its AbortSignal.

## Data sent to TypeSafe

An eligible review sends a bounded JSON snapshot containing:

- Complete pending tool arguments and justification, which may include source code or proposed file contents
- The current tool schema, mode transition, workspace roots, and working/command directory paths
- Current visible human instruction history and text from system/developer, project, and user-invoked skill constraints, labelled by authority
- A boolean describing the exact same-turn denial evidence

It does not collect environment values, arbitrary file contents, full assistant/tool transcripts, or unrelated tool output. It does not execute scripts or read project files to discover indirect effects. If an operation cannot be judged without those facts, a human must review it.

Common API-key, password, token, private-key, authorization, cookie, and credential-URL forms are detected locally. If detection would require redaction, the entire review snapshot is discarded and **no review request is sent**. Oversized, non-JSON, accessor-bearing, cyclic, or otherwise invalid state is also not sent. Pattern detection is not complete data-loss prevention. Non-secret private instructions, code, file contents already present in tool arguments, and paths can still be transmitted. Do not enable this plugin where that disclosure is unacceptable.

Incomplete authority is not reconstructed from summaries. Compaction checkpoints, seeded/forked ambiguity, unknown instruction producers, non-text instruction blocks, or child-only model prompts require human review. A direct parent's instruction may narrow a child's scope, but cannot override direct human restrictions.

## Logs and trust boundaries

DSH retains its authoritative `approval/asked` and `approval/decided` audit. Supplemental reviewer logs contain session/call IDs, tool name, bounded reason code, model ID, probabilities, confidences, routing choice, and latency. They contain no raw arguments, prompts, paths, commands, or API error bodies. Session/call identifiers may still be sensitive metadata.

The DSH approval event currently has no typed sandbox-origin discriminator. This package targets the inspected host contract and combines lifecycle, schema, mode, and exact-reason checks. It does not defend against malicious Host plugins that can forge events, replace tools, or alter the process. Arbitrary filesystem changes, symlink changes, environment changes, or effects inside executable scripts are not atomically attested by this reviewer. The sandbox remains the enforcement mechanism until the user or reviewer grants an escalation.

## Development and verification

```sh
npm ci --ignore-scripts --no-audit --cache .npm-cache
npm test
npm run check
npm pack --dry-run --ignore-scripts --cache .npm-cache
```

Tests cover domain routing and privacy plus real Cordis, approval, sandbox-policy, session-query, and tool-pipeline integration. Test tools have inert bodies. No shell mutation, live Jev traffic, profile installation, or publishing occurs in the suite. A real SDK smoke test uses mocked fetch and verifies a single request to the pinned origin with no raw SDK logging. These tests validate plumbing and fail-closed branches, not real-world model accuracy. Evaluate representative commands before trusting automatic decisions in your environment.

The initial dependency installation reported 20 high-severity advisories in the installed dependency tree. No forced upgrades were applied to DSH's version-pinned dependencies. An offline npm audit returned no advisory data and is not evidence that these reports were resolved. Review dependency advisories before deployment.

## Implementation

- [Host middleware](<src/index.js>) owns correlation, one-shot routing, cancellation, and stale-context checks.
- [Context handling](<src/context.js>) owns operation identity, denial evidence, and authority labels.
- [Jev policy](<src/review.js>) owns configuration, privacy validation, SDK transport, and probability gates.
- [Host settings schema](<src/config.js>) owns the write-only secret field and live credential adapter.
- [Settings page](<src/client.js>) uses DSH's revisioned configuration forms and existing Settings window.

API references: [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md), [Choice](https://docs.typesafe.ai/primitives/choice.md), and [LLM guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails.md).
