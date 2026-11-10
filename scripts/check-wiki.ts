/*
 * `bun scripts/check-wiki.ts`: checks the wiki sources in wiki/ and the README.
 *  - every page the sidebar links exists, and every wiki page is in the sidebar;
 *  - no broken internal link (wiki pages, repository files, images in docs/);
 *  - no em or en dash, no emoji, no personal path in the published texts.
 * Exits 1 on any problem. Files that another part of the repository must provide
 * (CONTRIBUTING.md, SECURITY.md) only warn when missing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const wikiDir = join(root, 'wiki');
const REPO = 'github.com/nicolabcraft/bureau';
const OPTIONAL = new Set(['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'LICENSE']);

const BANNED: [string, RegExp][] = [
  ['tiret cadratin ou demi-cadratin', new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`)],
  ['emoji', /\p{Extended_Pictographic}/u],
  ['chemin personnel', /\b[A-Za-z]:\\|\/Users\/|\/home\/[a-z]/],
];

const errors: string[] = [];
const warnings: string[] = [];

const pages = readdirSync(wikiDir).filter((name) => name.endsWith('.md'));
const pageSet = new Set(pages.map((name) => name.slice(0, -3)));

/** Markdown links and images outside code fences and inline code. */
function linksOf(text: string): string[] {
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...clean.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]!);
}

function checkRepoPath(file: string, path: string): void {
  const clean = decodeURIComponent(path.split('#')[0]!.split('?')[0]!).replace(/\/$/, '');
  if (clean === '') return;
  if (existsSync(join(root, clean))) return;
  (OPTIONAL.has(clean) ? warnings : errors).push(`${file} : fichier introuvable dans le dépôt : ${clean}`);
}

function checkLink(file: string, target: string, inWiki: boolean): void {
  if (target.startsWith('#') || target.startsWith('mailto:')) return;
  if (/^https?:\/\//.test(target)) {
    const url = new URL(target);
    const full = `${url.host}${url.pathname}`;
    const wiki = new RegExp(`^${REPO.replace(/\./g, '\\.')}/wiki/([^/]+)$`).exec(full);
    if (wiki) {
      if (!pageSet.has(decodeURIComponent(wiki[1]!))) errors.push(`${file} : page de wiki inconnue : ${wiki[1]}`);
      return;
    }
    const blob = new RegExp(`^${REPO.replace(/\./g, '\\.')}/(?:blob|tree)/main/(.+)$`).exec(full);
    if (blob) return checkRepoPath(file, blob[1]!);
    const raw = /^raw\.githubusercontent\.com\/nicolabcraft\/bureau\/main\/(.+)$/.exec(full);
    if (raw) return checkRepoPath(file, raw[1]!);
    return; // other sites are not checked offline
  }
  if (inWiki) {
    const name = decodeURIComponent(target.split('#')[0]!);
    if (name !== '' && !pageSet.has(name)) errors.push(`${file} : lien de wiki cassé : ${target}`);
  } else {
    checkRepoPath(file, target);
  }
}

// Sidebar and pages.
const sidebar = readFileSync(join(wikiDir, '_Sidebar.md'), 'utf8');
const inSidebar = new Set(linksOf(sidebar).map((target) => decodeURIComponent(target.split('#')[0]!)));
for (const name of inSidebar) if (!pageSet.has(name)) errors.push(`_Sidebar.md : la page ${name} n'existe pas`);
for (const name of pageSet) {
  if (name.startsWith('_') || name === 'Home') continue;
  if (!inSidebar.has(name)) errors.push(`${name}.md n'est pas dans _Sidebar.md`);
}
for (const required of ['Home', '_Sidebar', '_Footer']) if (!pageSet.has(required)) errors.push(`${required}.md manque`);

for (const name of pages) {
  const text = readFileSync(join(wikiDir, name), 'utf8');
  for (const target of linksOf(text)) checkLink(`wiki/${name}`, target, true);
  for (const [label, pattern] of BANNED) if (pattern.test(text)) errors.push(`wiki/${name} : ${label}`);
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
for (const target of linksOf(readme)) checkLink('README.md', target, false);
for (const [label, pattern] of BANNED) if (pattern.test(readme)) errors.push(`README.md : ${label}`);

for (const warning of warnings) console.warn(`Attention : ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`Erreur : ${error}`);
  process.exit(1);
}
console.log(`Wiki : ${pages.length} pages, README et liens vérifiés, aucun problème.`);
