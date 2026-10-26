import { readFileSync } from 'node:fs';

// Le fichier package.json est à deux niveaux au-dessus, depuis src/common comme depuis dist/common.
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version?: unknown;
};

/** Version de l'API (champ `version` de package.json), renvoyée par `GET /v1/health`. */
export const APP_VERSION = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
