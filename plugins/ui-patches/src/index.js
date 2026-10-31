/** Shared page patches, independent of browser origin, posture, and client storage. */
export const name = 'ui-patches';
export const inject = ['webServer'];

// Target only billing's own capsules. Never hide the shared composer dock,
// whose other occupants can include useful controls from unrelated plugins.
const COMPOSER_PRICING_CSS = `
[data-testid="billing-live-cost-bar"],
[data-testid="billing-live-cost-chip"] {
  display: none !important;
}
`;

/** Apply the same stylesheet to every shell served by this profile. */
export function apply(ctx, config = {}) {
  const hideComposerPricing = config.hideComposerPricing ?? true;
  if (typeof hideComposerPricing !== 'boolean') {
    throw new TypeError('ui-patches: hideComposerPricing must be a boolean');
  }
  if (!hideComposerPricing) return;

  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'style', text: COMPOSER_PRICING_CSS });
  });
}
