# DSH UI patches

Small UI corrections shared by the local web UI, paired remote browsers, mobile views, and the mini window.

## Composer pricing

Hides the billing plugin's peak/off-peak and turn/session pricing capsule, including its optional toolbar position. The billing dashboard, chat input, and other composer dock controls are unchanged.

The mini-window plugin already hides its own composer footer, but that rule is scoped to the mini window. Billing also stores its display preference separately for each browser origin. This plugin instead injects a stylesheet into the shared web shell, so the patch applies before client rendering without changing anyone's local storage or requiring a client bundle rebuild.

## Fira Code

Makes [Fira Code](https://github.com/tonsky/FiraCode) the code font for inline code, fenced code blocks, and every other surface that uses the shell's code font. The font file ships with the plugin and the host serves it at `/ui-patches/fonts/fira-code-6.2.woff2`, so remote and mobile browsers render it without a local install.

The patch only replaces the built-in default stack. A font entered under Settings > General > Code font still takes precedence.

Fira Code is licensed under the SIL Open Font License 1.1, see [assets/FiraCode-OFL.txt](assets/FiraCode-OFL.txt).

## Install

```sh
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-ui-patches
```

Refresh each open browser after installing or changing the patch. No build step is required.

To turn either patch off, disable the plugin or set this profile override:

```yaml
- id: ui-patches
  config:
    hideComposerPricing: false
    firaCode: false
```

## Test

```sh
pnpm install
pnpm test
```
