/*
 * Checks that a release tag, package.json and boite-plugin.json agree before
 * a release is published: the tag is `v<version>`, both files carry that
 * version, and the manifest's artifact URL points at this tag's bureau.js.
 *
 * `bun scripts/check-release.ts <tag>`, for example `bun scripts/check-release.ts v0.1.0`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;

/** The problems between the tag and the two files, none when they agree. */
export function releaseProblems(tag: string, pkg: Record<string, unknown>, manifest: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) problems.push(`Le tag « ${tag} » doit être de la forme vMAJEUR.MINEUR.CORRECTIF.`);
  const version = tag.replace(/^v/, '');
  if (pkg.version !== version) problems.push(`package.json : version ${String(pkg.version)}, le tag demande ${version}.`);
  if (manifest.version !== version) problems.push(`boite-plugin.json : version ${String(manifest.version)}, le tag demande ${version}.`);
  const artifacts = manifest.artifacts as { any?: { url?: unknown } } | undefined;
  const url = artifacts?.any?.url;
  const homepage = typeof manifest.homepage === 'string' ? manifest.homepage.replace(/\/+$/, '') : '';
  const expected = `${homepage}/releases/download/${tag}/${String(manifest.executable)}.js`;
  if (url !== expected) problems.push(`boite-plugin.json : artifacts.any.url vaut ${String(url)}, il devrait valoir ${expected}.`);
  return problems;
}

if (import.meta.main) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('Usage : bun scripts/check-release.ts <tag>');
    process.exit(2);
  }
  const problems = releaseProblems(tag, read('package.json'), read('boite-plugin.json'));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`${tag} : package.json et boite-plugin.json concordent.`);
}
