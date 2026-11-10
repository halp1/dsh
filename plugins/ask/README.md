# dsh-plugin-ask

Adds an `/ask` command to DeepSeek Harness, modeled on Cursor's Ask mode. The agent answers your question and makes no permanent changes.

```text
/ask why does the session list reload twice on startup?
```

## Behavior

`/ask <question>` sends the question to the agent as an ordinary user message. Right before it, the plugin adds a context notice that tells the agent to stay hands-off for that question. The agent may:

- read files, search code, inspect git, and search the web
- run commands that only observe, such as diffs, type checks that emit nothing, or existing tests
- write throwaway scripts or clones under the system temporary directory to test an idea, and delete them afterward

It must not edit workspace files, change repository state, install anything, run builds or formatters, start services, change settings, or post to external services. When an answer calls for a change, the agent shows the code or diff in its reply instead of applying it.

Composer attachments are accepted, so `/ask` with an image and no text works too.

## Limits

The sandbox mode and approval policy stay exactly as they were. Ask mode is an instruction, not an enforcement layer, so a session in `workspace-write` or `danger-full-access` still technically allows writes. Use `read-only` when you need a hard guarantee.

The rules apply to the asked question. The next plain message returns to normal behavior, although the notice stays in the conversation history.

## Install

From a checkout of this repository:

```json
{ "action": "install_bundle", "target": "/absolute/path/to/plugins/ask" }
```

The bundle registers one Host plugin entry, `ask`.

## Test

```sh
pnpm --filter dsh-plugin-ask run test
```
