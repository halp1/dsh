# DSH UI patches

Small UI corrections shared by the local web UI, paired remote browsers, mobile views, and the mini window.

## Composer pricing

Hides the billing plugin's peak/off-peak and turn/session pricing capsule, including its optional toolbar position. The billing dashboard, chat input, and other composer dock controls are unchanged.

The mini-window plugin already hides its own composer footer, but that rule is scoped to the mini window. Billing also stores its display preference separately for each browser origin. This plugin instead injects a stylesheet into the shared web shell, so the patch applies before client rendering without changing anyone's local storage or requiring a client bundle rebuild.

## Install

```sh
dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-ui-patches
```

Refresh each open browser after installing or changing the patch. No build step is required.

To restore the capsules, disable the plugin or set this profile override:

```yaml
- id: ui-patches
  config:
    hideComposerPricing: false
```

## Test

```sh
pnpm install
pnpm test
```
