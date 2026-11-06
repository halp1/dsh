/**
 * dsh-plugin-quickswitcher, node half.
 *
 * Pure UI plugin: the empty apply exists so the host Loader mounts a row for
 * the package. That row is what makes the client-modules scanner read this
 * package's `dsh.client` declaration and serve the browser half at
 * `/plugins/dsh-plugin-quickswitcher/client.js`.
 * @module dsh-plugin-quickswitcher
 */

/** Stable Cordis plugin name. */
export const name = 'quickswitcher'

/** Host plugin body: no host-side behavior. */
export function apply(): void {}
