/*
 * `bun run pack`: bundles src/main.ts into the single file `bureau.js`,
 * copies skills/<name>.md into `provides.skills`, writes the file's SHA-256
 * into `artifacts.any.sha256` and checks the result against Boite's limits.
 * Upload bureau.js unchanged at the URL `artifacts.any.url` names.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestProblems } from './check-manifest';

export const SKILLS = ['bureau-chef', 'bureau-manager', 'bureau-agent'] as const;
const root = join(import.meta.dir, '..');

export interface SkillFile {
  description: string;
  body: string;
}

const unquote = (value: string): string => value.replace(/^(["'])(.*)\1$/s, '$2').trim();

/** Splits a SKILL.md into its `description:` front matter line and the body without front matter. */
export function parseSkill(name: string, text: string): SkillFile {
  const normal = text.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normal);
  if (!match) throw new Error(`skills/${name}.md : le front matter (--- ... ---) manque.`);
  const lines = match[1]!.split('\n');
  const at = lines.findIndex((line) => /^description:/.test(line));
  if (at < 0) throw new Error(`skills/${name}.md : la ligne « description: » manque dans le front matter.`);
  let description = lines[at]!.slice('description:'.length).trim();
  if (/^[>|][+-]?$/.test(description) || description === '') {
    // A folded or literal block: the indented lines that follow.
    const block: string[] = [];
    for (let index = at + 1; index < lines.length && /^\s+\S/.test(lines[index]!); index++) block.push(lines[index]!.trim());
    description = block.join(' ');
  } else {
    description = unquote(description);
  }
  if (description === '') throw new Error(`skills/${name}.md : la description est vide.`);
  const body = normal.slice(match[0].length).replace(/^\n+/, '').trimEnd();
  if (body === '') throw new Error(`skills/${name}.md : le texte du skill est vide.`);
  return { description, body: `${body}\n` };
}

if (import.meta.main) {
  const manifestPath = join(root, 'boite-plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    schema: number;
    runtime?: string;
    executable?: string;
    artifacts: { any: { url: string; sha256: string } };
    provides: { skills?: { name: string; description: string; body: string }[] };
  };
  if (manifest.schema !== 2 || manifest.runtime !== 'bun' || !manifest.executable) {
    console.error('boite-plugin.json doit être en schema 2, runtime bun, avec un executable.');
    process.exit(1);
  }

  const outfile = `${manifest.executable}.js`;
  const build = Bun.spawnSync([process.execPath, 'build', 'src/main.ts', '--target', 'bun', '--outfile', outfile], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (build.exitCode !== 0) {
    console.error('bun build a échoué.');
    process.exit(1);
  }

  const skills: { name: string; description: string; body: string }[] = [];
  for (const name of SKILLS) {
    const path = join(root, 'skills', `${name}.md`);
    if (!existsSync(path)) {
      console.warn(`Avertissement : skills/${name}.md est absent, le skill ${name} n'est pas dans le manifeste.`);
      continue;
    }
    try {
      const skill = parseSkill(name, readFileSync(path, 'utf8'));
      skills.push({ name, description: skill.description, body: skill.body });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
  manifest.provides.skills = skills;
  manifest.artifacts.any.sha256 = createHash('sha256').update(readFileSync(join(root, outfile))).digest('hex');

  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const problems = manifestProblems(text);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error('Manifeste non écrit.');
    process.exit(1);
  }
  writeFileSync(manifestPath, text);
  console.log(`${outfile} : sha256 ${manifest.artifacts.any.sha256}`);
  console.log(`Manifeste mis à jour : ${skills.length}/${SKILLS.length} skills.`);
}
