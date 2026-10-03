/**
 * Load the browser artifact in Node: it registers itself through
 * `window.__ModuleLoader__.load`, so stub that and run the factory.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/client.js', import.meta.url)), 'utf8');

/**
 * @param {(spec: string) => unknown} [require] - module-table stub.
 * @returns {Record<string, any>} the client bundle's exports.
 */
export function loadClient(require = () => { throw new Error('no require in tests'); }) {
  let registration;
  const sandbox = { window: { __ModuleLoader__: { load: (r) => { registration = r; } } } };
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' });
  if (registration === undefined) throw new Error('client.js did not register');
  if (registration.id !== 'dsh-plugin-latex') throw new Error(`unexpected id ${registration.id}`);
  return registration.factory(require);
}
