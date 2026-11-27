/**
 * Loaded before every test file. `apply()` starts a real poll, which would read
 * the live subscriptions token file and spend real lookups against usage
 * endpoints that extend their own lockout on bursts. Point HOME at an empty
 * directory and make any unstubbed fetch fail loudly instead.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.HOME = mkdtempSync(join(tmpdir(), 'auto-limit-test-'));

globalThis.fetch = async (url) => {
  throw new Error(`test made a network call to ${url}`);
};
