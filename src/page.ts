/*
 * Builds the page the service serves, so the plugin stays one file.
 * `readPage` is the pixel view: web/pixel/shell.html with the modules of web/pixel/ (PIXEL_FILES) and the
 * app glue web/pixel/app.js inlined. `readIsoPage` is the isometric view (web/index.html, web/immeuble/,
 * web/app.js): kept in the repository and tested, no longer served.
 * src/main.ts calls `readPage` as a Bun macro: the page is read once, at bundle time.
 * scripts/demo.ts calls it at run time, on every request, to pick up edits.
 * See docs/vue-pixel.md (pixel view) and docs/vue-immeuble.md (isometric view) for what each module owns.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Scene modules of the isometric view, in load order. They share one scope: one function wraps them all. */
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

/** Modules of the pixel view, in load order (docs/vue-pixel.md 2.2). One shared scope, like SCENE_FILES. */
export const PIXEL_FILES = [
  'palette.js',
  'font.js',
  'engine.js',
  'floorplan.js',
  'floor.js',
  'sprites.js',
  'actions.js',
  'people.js',
  'sky.js',
  'build.js',
  'dialogues.js',
  'talk.js',
  'dialog.js',
  'nav.js',
  'facade.js',
  'input.js',
  'ui.js',
  'advanced.js',
  'tubes.js',
  'journal.js',
  'techplan.js',
  'boot.js',
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

/** A source file of the repository, with LF line endings whatever the checkout did. */
function readSource(path: string): string {
  return readFileSync(join(import.meta.dir, '..', path), 'utf8').split('\r\n').join('\n');
}

/** Reads the sources from the repository and assembles the pixel view. */
export function readPage(): string {
  const read = readSource;
  const scene = PIXEL_FILES.map((name) => ({ name, text: read(`web/pixel/${name}`) }));
  return assemblePage(read('web/pixel/shell.html'), scene, read('web/pixel/app.js'));
}

/** Reads the sources and assembles the isometric view (not served any more, still tested). */
export function readIsoPage(): string {
  const read = readSource;
  const scene = SCENE_FILES.map((name) => ({ name, text: read(`web/immeuble/${name}`) }));
  return assemblePage(read('web/index.html'), scene, read('web/app.js'));
}
