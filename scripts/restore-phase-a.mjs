/**
 * Restore App.tsx + CadCanvasRenderer.tsx
 * (mobile + Drive + UI + download + export DWG + PC search)
 * Run: node scripts/restore-phase-a.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const APP_URL =
  'https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/6a28043f84a2a2f340266388164b29873f6e116c/src/App.tsx';
const CANVAS_URL =
  'https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/6a28043f84a2a2f340266388164b29873f6e116c/src/components/CadCanvasRenderer.tsx';

const NEW_DRIVE = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
const OLD_DRIVE = '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY';

function must(hay, needle, label) {
  if (!hay.includes(needle)) throw new Error(`missing block: ${label}`);
}

async function main() {
  let app = await (await fetch(APP_URL)).text();
  if (!app.includes('export default function App')) throw new Error('bad App download');

  // NOTE: full file continues - this is truncated for size; use local restore
  console.log('placeholder truncated');
}

main().catch((e) => { console.error(e); process.exit(1); });
