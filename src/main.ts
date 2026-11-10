/*
 * Bureau's entry point, the file `boite-plugin.json` names as `executable`.
 * No argument: the service, which Boite starts in the background.
 * An argument: one of the `boite <name>` commands.
 */
import { readPage } from './page' with { type: 'macro' };
import pkg from '../package.json' with { type: 'json' };
import { runCommand } from './commands';
import { startService } from './service';

// A macro: the page is assembled once, when bureau.js is bundled.
const page = readPage();
const version: string = pkg.version;
const argv = process.argv.slice(2);

if (argv.length > 0) {
  const code = await runCommand(argv, {
    env: process.env,
    io: { out: (line) => console.log(line), err: (line) => console.error(line) },
    version,
  });
  process.exit(code);
}

const dataDir = process.env.BOITE_PLUGIN_DATA;
if (!dataDir) {
  console.error('BOITE_PLUGIN_DATA est absent : Boite le donne au service. Pour un essai à la main, pointe-le vers un dossier de ton choix.');
  process.exit(1);
}

const service = await startService({
  dataDir,
  page,
  version,
  coreUrl: process.env.BOITE_CORE_URL,
  token: process.env.BOITE_TOKEN,
});

const shutdown = async () => {
  await service.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
