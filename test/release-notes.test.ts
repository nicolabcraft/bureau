import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection, releaseNotes } from '../scripts/release-notes';

const root = join(import.meta.dir, '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const SHA = 'a'.repeat(64);

describe('release notes', () => {
  test('the changelog has a section for the version of package.json', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(changelogSection(read('CHANGELOG.md'), version).length).toBeGreaterThan(50);
  });

  test('the real notes hold the changelog section and the full install guide, every mark filled', () => {
    const notes = releaseNotes('v0.1.0', SHA, read('CHANGELOG.md'), read('.github/release/installation.md'));
    expect(notes).toContain('Première version publique.');
    expect(notes).toContain('## Installer Bureau depuis zéro');
    expect(notes).toContain('### Vérifier que ça marche');
    expect(notes).toContain(SHA);
    expect(notes).toContain('(v0.1.0)');
    expect(notes).not.toMatch(/\{\{/);
  });

  test('a section stops at the next version', () => {
    const changelog = '# Journal\n\n## 0.2.0\n\nNouveau.\n\n## 0.1.0\n\nAncien.\n';
    expect(changelogSection(changelog, '0.2.0')).toBe('Nouveau.');
    expect(changelogSection(changelog, '0.1.0')).toBe('Ancien.');
  });

  test('a missing or empty section, a bad sum or an unfilled mark is refused', () => {
    expect(() => changelogSection('## 0.1.0\n', '0.1.0')).toThrow();
    expect(() => changelogSection('## 0.1.0\n\nx\n', '0.2.0')).toThrow();
    expect(() => releaseNotes('v0.1.0', 'abc', '## 0.1.0\n\nx\n', 'guide')).toThrow();
    expect(() => releaseNotes('v0.1.0', SHA, '## 0.1.0\n\nx\n', '{{AUTRE}}')).toThrow();
  });
});
