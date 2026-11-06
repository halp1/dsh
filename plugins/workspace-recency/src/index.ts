/**
 * dsh-plugin-workspace-recency, node half.
 *
 * Pure UI plugin: the empty apply exists so the plugin appears in the profile's
 * composed tree and the host Loader mounts a row for it. That row is what makes
 * the client-modules scanner read this package's `dsh.client` declaration and
 * serve the browser half at `/plugins/dsh-plugin-workspace-recency/client.js`.
 *
 * There is deliberately no host-side state: the ordering is a view over state
 * the Workspace and Session Controllers already project into the browser, and
 * keeping it browser-local is what lets the host's stored manual order survive
 * untouched.
 * @module dsh-plugin-workspace-recency
 */

/** Stable Cordis plugin name. */
export const name = 'workspace-recency'

/** Host plugin body — no host-side behavior for this plugin. */
export function apply(): void {}
