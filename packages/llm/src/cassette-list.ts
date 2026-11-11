import { existsSync, readdirSync } from 'node:fs';
import { cassetteDir } from './cassette.ts';

/**
 * Lists recorded cassette keys.
 *
 * In a module of its own, imported only by the cassette suite, because it scans a
 * directory. Anything reachable from a Next API route — and `cassette.ts` is, through the
 * client — makes the bundler conclude it must trace the entire project into the server
 * bundle, source files and public folder included. Keeping this out of that import graph
 * is cheaper and more honest than annotating the access as safe.
 */
export function listCassettes(): readonly string[] {
  if (!existsSync(cassetteDir())) return [];
  return readdirSync(cassetteDir())
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}
