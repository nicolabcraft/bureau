/*
 * `bun scripts/release-notes.ts <tag> <sha256>`: prints the notes of a GitHub release on stdout.
 * They are the version's section of CHANGELOG.md, then the full install guide of
 * .github/release/installation.md with the tag and the SHA-256 of bureau.js filled in.
 * The release workflow (.github/workflows/release.yml) writes them to a file for `gh release create --notes-file`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

/** The body of the `## <version>` section of a changelog, without its title. Throws when the section is missing or empty. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md : la section « ## ${version} » manque.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^## /.test(lines[index]!)) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (body === '') throw new Error(`CHANGELOG.md : la section « ## ${version} » est vide.`);
  return body;
}

/** The release notes: the changelog section, then the install guide with {{TAG}} and {{SHA256}} filled in. */
export function releaseNotes(tag: string, sha256: string, changelog: string, guide: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Somme SHA-256 invalide : « ${sha256} ».`);
  const version = tag.replace(/^v/, '');
  const filled = guide.replace(/\{\{TAG\}\}/g, tag).replace(/\{\{SHA256\}\}/g, sha256);
  if (/\{\{[A-Z0-9_]+\}\}/.test(filled)) throw new Error('.github/release/installation.md : une marque {{...}} n’est pas remplie.');
  return `${changelogSection(changelog, version)}\n\n${filled.trim()}\n`;
}

if (import.meta.main) {
  const [tag, sha256] = process.argv.slice(2);
  if (!tag || !sha256) {
    console.error('Usage : bun scripts/release-notes.ts <tag> <sha256>');
    process.exit(2);
  }
  try {
    const read = (path: string): string => readFileSync(join(root, path), 'utf8');
    process.stdout.write(releaseNotes(tag, sha256, read('CHANGELOG.md'), read('.github/release/installation.md')));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
