/*
 * Builds the page the service serves: web/index.html with the scene modules of
 * web/immeuble/ and the app glue web/app.js inlined, so the plugin stays one file.
 * src/main.ts calls `readPage` as a Bun macro: the page is read once, at bundle time.
 * scripts/demo.ts calls it at run time, on every request, to pick up edits.
 * See docs/vue-immeuble.md for what each module owns.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Scene modules, in load order. They share one scope: one function wraps them all. */
export const SCENE_FILES = [
  'noyau.js',
  'lumiere.js',
  'etages.js',
  'chantier.js',
  'ville.js',
  'agents.js',
  'plan.js',
  'donnees.js',
  'moteur.js',
  'hud.js',
  'controles.js',
  'boucle.js',
] as const;

export const SCRIPTS_MARK = '<!-- scripts -->';

/** Puts the scene (one strict function scope) then the app glue in place of the mark. */
export function assemblePage(shell: string, scene: { name: string; text: string }[], app: string): string {
  if (!shell.includes(SCRIPTS_MARK)) throw new Error(`web/index.html : la marque ${SCRIPTS_MARK} manque.`);
  for (const file of [...scene, { name: 'app.js', text: app }]) {
    if (/<\/script/i.test(file.text)) throw new Error(`${file.name} contient « </script » : la page serait coupée.`);
  }
  const body = scene.map((file) => `/* ---- ${file.name} */\n${file.text.trimEnd()}\n`).join('\n');
  const scripts = `<script>\n(() => {\n'use strict';\n${body}})();\n</script>\n<script>\n${app.trimEnd()}\n</script>`;
  return shell.replace(SCRIPTS_MARK, () => scripts);
}

/** Reads the sources from the repository and assembles the page. */
export function readPage(): string {
  const root = join(import.meta.dir, '..');
  const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
  const scene = SCENE_FILES.map((name) => ({ name, text: read(`web/immeuble/${name}`) }));
  return assemblePage(read('web/index.html'), scene, read('web/app.js'));
}
