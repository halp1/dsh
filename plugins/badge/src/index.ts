/**
 * dsh-plugin-badge, node half.
 *
 * Pure UI plugin: the empty apply exists so the plugin appears in the profile's
 * composed tree and the host Loader mounts a row for it. That row is what makes
 * the client-modules scanner read this package's `dsh.client` declaration and
 * serve the browser half at `/plugins/dsh-plugin-badge/client.js`.
 *
 * There is deliberately no host-side state: the badge reflects what a
 * particular browser's sidebar shows, and the sidebar's unread facts
 * (pending approvals, questions, the completed reminder bit) are already
 * projected into the client by the Session/Workspace Controllers.
 * @module dsh-plugin-badge
 */

/** Stable Cordis plugin name. */
export const name = 'badge'

/** Host plugin body — no host-side behavior for the badge plugin. */
export function apply(): void {}
