import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseProblems } from '../scripts/check-release';
import { labelProblems, type Label } from '../scripts/labels';

const root = join(import.meta.dir, '..');
const github = join(root, '.github');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');
const yaml = (...parts: string[]) => Bun.YAML.parse(read(...parts)) as Record<string, unknown>;
const labels = JSON.parse(read('.github', 'labels.json')) as Label[];
const labelNames = new Set(labels.map((label) => label.name));
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const workflows = readdirSync(join(github, 'workflows')).filter((file) => file.endsWith('.yml'));
const templates = readdirSync(join(github, 'ISSUE_TEMPLATE')).filter((file) => file.endsWith('.yml'));

describe('workflows', () => {
  test.each(workflows)('%s is valid YAML with jobs and least privilege', (file) => {
    const workflow = yaml('.github', 'workflows', file);
    expect(typeof workflow.name).toBe('string');
    expect(workflow.on).toBeDefined();
    expect(workflow.permissions).toBeDefined();
    expect(Object.keys(workflow.jobs as object).length).toBeGreaterThan(0);
  });

  test.each(workflows)('%s pins every action to a commit', (file) => {
    for (const match of read('.github', 'workflows', file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      const use = match[1]!;
      if (use.startsWith('./')) continue;
      expect(use).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe('issue forms', () => {
  test.each(templates.filter((file) => file !== 'config.yml'))('%s has a body, known labels and required fields', (file) => {
    const form = yaml('.github', 'ISSUE_TEMPLATE', file);
    expect(typeof form.name).toBe('string');
    expect(typeof form.description).toBe('string');
    for (const label of form.labels as string[]) expect(labelNames.has(label)).toBe(true);
    const ids = new Set<string>();
    for (const item of form.body as { type: string; id?: string; attributes?: { label?: string } }[]) {
      if (item.type === 'markdown') continue;
      expect(item.id).toBeTruthy();
      expect(ids.has(item.id!)).toBe(false);
      ids.add(item.id!);
      expect(item.attributes?.label).toBeTruthy();
    }
  });

  test('config.yml closes blank issues and links the wiki, discussions and advisories', () => {
    const config = yaml('.github', 'ISSUE_TEMPLATE', 'config.yml') as { blank_issues_enabled: boolean; contact_links: { url: string }[] };
    expect(config.blank_issues_enabled).toBe(false);
    const urls = config.contact_links.map((link) => link.url).join(' ');
    expect(urls).toContain('/security/advisories/new');
    expect(urls).toContain('/wiki');
    expect(urls).toContain('/discussions');
  });
});

describe('labels', () => {
  test('labels.json is sound', () => {
    expect(labelProblems(labels)).toEqual([]);
  });

  test('labelProblems names the faults', () => {
    const problems = labelProblems([{ name: 'a', color: '#fff', description: 'x' }, { name: 'A', color: 'ffffff', description: 'y'.repeat(101) }]);
    expect(problems.length).toBe(3);
  });

  test('every label the labeler, dependabot and the forms use exists', () => {
    const used = new Set<string>(Object.keys(yaml('.github', 'labeler.yml')));
    const dependabot = yaml('.github', 'dependabot.yml') as { updates: { labels: string[] }[] };
    for (const update of dependabot.updates) for (const label of update.labels) used.add(label);
    for (const label of used) expect(labelNames.has(label)).toBe(true);
  });

  test('the labeler targets paths that exist', () => {
    const labeler = yaml('.github', 'labeler.yml') as Record<string, { 'changed-files': { 'any-glob-to-any-file': string[] }[] }[]>;
    for (const rules of Object.values(labeler)) {
      for (const rule of rules) {
        for (const glob of rule['changed-files'].flatMap((entry) => entry['any-glob-to-any-file'])) {
          expect(new Bun.Glob(glob).scanSync({ cwd: root, dot: true }).next().done === false || existsSync(join(root, glob.replace(/\/?\*\*$/, '')))).toBe(true);
        }
      }
    }
  });
});

describe('releaseProblems', () => {
  const manifest = {
    version: '1.2.3',
    homepage: 'https://github.com/o/r',
    executable: 'bureau',
    artifacts: { any: { url: 'https://github.com/o/r/releases/download/v1.2.3/bureau.js' } },
  };

  test('agrees when tag, package.json and manifest match', () => {
    expect(releaseProblems('v1.2.3', { version: '1.2.3' }, manifest)).toEqual([]);
  });

  test('refuses a tag that is not a version', () => {
    expect(releaseProblems('1.2', { version: '1.2.3' }, manifest).length).toBeGreaterThan(0);
  });

  test('refuses a package.json, a manifest or an artifact URL on another version', () => {
    expect(releaseProblems('v1.2.4', { version: '1.2.3' }, manifest)).toHaveLength(3);
    expect(releaseProblems('v1.2.3', { version: '1.2.2' }, manifest)).toHaveLength(1);
    expect(releaseProblems('v1.2.3', { version: '1.2.3' }, { ...manifest, artifacts: { any: { url: 'https://example.com/bureau.js' } } })).toHaveLength(1);
  });

  test('the repository files agree with their own version', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    const real = JSON.parse(read('boite-plugin.json')) as Record<string, unknown>;
    expect(releaseProblems(`v${String(pkg.version)}`, pkg, real)).toEqual([]);
  });
});

describe('text files', () => {
  test('no .github or root document holds an em or en dash', () => {
    const files = [
      ...readdirSync(root).filter((file) => file.endsWith('.md')),
      ...workflows.map((file) => join('.github', 'workflows', file)),
      ...templates.map((file) => join('.github', 'ISSUE_TEMPLATE', file)),
      '.github/pull_request_template.md',
      '.github/labels.json',
      '.github/labeler.yml',
      '.github/dependabot.yml',
    ];
    for (const file of files) expect([file, DASHES.test(read(file))]).toEqual([file, false]);
  });
});
