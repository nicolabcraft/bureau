/*
 * Creates or updates the repository labels listed in .github/labels.json with
 * the GitHub CLI (`gh`, already signed in).
 *
 * `bun scripts/labels.ts [--repo owner/name] [--dry-run] [--defauts]`
 *   --repo      the repository; by default the one of the current folder
 *   --dry-run   prints the commands without running them
 *   --defauts   also deletes GitHub's English default labels that these ones replace
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Label {
  name: string;
  color: string;
  description: string;
}

/** GitHub's default labels that a French label of labels.json replaces. */
export const DEFAULT_LABELS = ['enhancement', 'good first issue', 'help wanted', 'duplicate', 'invalid', 'wontfix'];

/** The problems with a label list, none when it is sound. */
export function labelProblems(labels: unknown): string[] {
  if (!Array.isArray(labels)) return ['labels.json doit être une liste.'];
  const problems: string[] = [];
  const names = new Set<string>();
  labels.forEach((label: Partial<Label>, index) => {
    const where = `labels.json[${index}]`;
    if (typeof label?.name !== 'string' || label.name.trim() === '' || label.name.length > 50) problems.push(`${where}.name : 1 à 50 caractères.`);
    else if (names.has(label.name.toLowerCase())) problems.push(`${where}.name : « ${label.name} » est en double.`);
    else names.add(label.name.toLowerCase());
    if (typeof label?.color !== 'string' || !/^[0-9a-f]{6}$/.test(label.color)) problems.push(`${where}.color : six chiffres hexadécimaux en minuscules, sans #.`);
    if (typeof label?.description !== 'string' || label.description.length > 100) problems.push(`${where}.description : au plus 100 caractères.`);
  });
  return problems;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const defaults = args.includes('--defauts');
  const repoAt = args.indexOf('--repo');
  const repo = repoAt >= 0 ? args[repoAt + 1] : undefined;
  if (repoAt >= 0 && (!repo || repo.startsWith('--'))) {
    console.error('--repo attend owner/nom.');
    process.exit(2);
  }
  const labels = JSON.parse(readFileSync(join(import.meta.dir, '..', '.github', 'labels.json'), 'utf8')) as Label[];
  const problems = labelProblems(labels);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }

  const gh = (...command: string[]): number => {
    const full = ['gh', ...command, ...(repo ? ['--repo', repo] : [])];
    console.log(full.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' '));
    if (dry) return 0;
    return Bun.spawnSync(full, { stdout: 'inherit', stderr: 'inherit' }).exitCode;
  };

  let failed = 0;
  for (const label of labels) {
    // --force updates the colour and description of a label that already exists.
    if (gh('label', 'create', label.name, '--color', label.color, '--description', label.description, '--force') !== 0) failed++;
  }
  if (defaults) {
    for (const name of DEFAULT_LABELS) {
      if (gh('label', 'delete', name, '--yes') !== 0) console.error(`Étiquette ${name} : pas supprimée (absente ?).`);
    }
  }
  if (failed > 0) {
    console.error(`${failed} étiquette(s) en échec.`);
    process.exit(1);
  }
  console.log(`${labels.length} étiquettes à jour.`);
}
