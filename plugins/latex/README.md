# dsh-plugin-latex

LaTeX math for DeepSeek Harness. It does two things:

1. **Every agent writes math as LaTeX.** A system-prompt section tells every
   agent (top-level sessions, subagents, forks, workflow agents) to put math in
   `$…$` / `$$…$$`, never `x^2` or `sqrt(x)` stand-ins.
2. **Math renders while the reply streams.** DSH's chat already renders TeX
   with KaTeX, but only after a message finishes. Until then you see raw
   `$\frac{a}{b}$` source. This plugin renders formulas as they arrive.

## Install

```bash
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-latex
```

Restart `dsh web` (or rely on `patchReload: live`), then reload the page. The
prompt section applies from the next model step on, including in sessions that
are already open.

pnpm installs `file:` dependencies as a copy, so after editing the source run
the same `add` command again.

## What you can write

These are the delimiters DSH's renderer parses:

| Syntax | Kind |
| --- | --- |
| `$x^2$`, `\(x^2\)` | inline |
| `$$` on its own line, formula, `$$` on its own line | display |
| `\[` … `\]` | display |
| `$$x^2$$` on one line | display |
| a ` ```math ` code block | display |

Write a literal dollar in prose as `\$`.

## How live rendering works

The host's `MarkdownText` (in `@deepseek-ai/dsh-client-ui-primitives`, a
platform module shared by every surface) has two arms. The settled arm parses
with the math grammar and renders KaTeX. The streaming arm parses without it,
so half-written formulas never flash KaTeX errors.

The browser half swaps the component behind the shared `MarkdownText` memo
object. Messages that are settled, or that contain no math, take the original
code path unchanged. A streaming message with math is cut into blocks at safe
top-level boundaries (a blank line followed by a non-indented, non-list,
non-quote line, outside code fences and display math):

- **Completed blocks** render through the settled arm once and stay memoized.
- **The growing block** renders through the settled arm if it has math,
  otherwise through the original incremental streaming arm.
- **An unclosed inline formula** (`$x^2 + …`) has its opener escaped, so it
  reads as plain text, exactly as it would without the plugin, until the
  closing `$` arrives. Nothing is hidden, so a literal `$` never stalls the
  stream.
- **An unclosed display formula** is previewed, slightly dimmed, from its
  complete lines. Open `\begin{…}` environments, braces and `\left` are closed
  automatically, so a long `aligned` derivation grows line by line.

Once the message settles, the host's own full render takes over.

Known limits while streaming (the settled render is always exact):

- A reference-style link or footnote whose definition sits in another block
  shows literally until the message finishes. The host's streaming arm has the
  same limitation.
- Messages mounted before the plugin loaded keep the old renderer until they
  re-mount.

## Config

```yaml
# profile cordis.patch.yml
- id: latex
  config:
    prompt: false          # render only; don't add the prompt section
    # promptText: "..."    # replace the built-in guidance
```

The guidance text is in [src/prompt.js](src/prompt.js). The section uses
`interpolate: false`, so LaTeX braces are never read as `{{prompt variables}}`.
A preset that replaces the entire system prompt with a `complete` section is
the only kind of agent this cannot reach.

## Layout

- `src/index.js`: node half (the prompt section)
- `src/prompt.js`: the guidance text
- `src/client.js`: browser half, shipped as-is in the client module system's
  closure-factory format (`react` and the primitives come from the module
  table, so there is no build step)
- `test/`: `npm test`
