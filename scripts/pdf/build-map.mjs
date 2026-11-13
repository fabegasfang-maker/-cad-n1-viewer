/**
 * Restore pre-AB map pipeline (logic = gen v7 / commit dd4bca2).
 * GENERATOR_VERSION=10 forces tile rebuild after A/B experiments.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dwgToDxf } from './dwg-to-dxf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_DIR = path.resolve(HERE, '../../public/map');
const META_PATH = path.join(MAP_DIR, 'meta.json');

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KEY = process.env.GOOGLE_API_KEY || '';
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const GENERATOR_VERSION = 10;
const MOBILE_NAME = /mobile|mob\b|phone|เล็ก|มือถือ|_mobile/i;

const THAI_MONTHS = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};

const ts = (f) => (f.modifiedTime ? Date.parse(f.modifiedTime) : 0);
const byModifiedDesc = (a, b) => ts(b) - ts(a) || String(b.name).localeCompare(String(a.name), 'th');

function monthKey(name) {
  const n = (name || '').trim();
  for (const [th, mon] of Object.entries(THAI_MONTHS)) {
    if (n.includes(th)) return (parseInt(n.match(/(\d{4})/)?.[1] || '0', 10)) * 100 + mon;
  }
  const abbr = [[/ม\.ค\./, 1], [/ก\.พ\./, 2], [/มี\.ค\./, 3], [/เม\.ย\./, 4], [/พ\.ค\./, 5], [/มิ\.ย\./, 6],
    [/ก\.ค\./, 7], [/ส\.ค\./, 8], [/ก\.ย\./, 9], [/ต\.ค\./, 10], [/พ\.ย\./, 11], [/ธ\.ค\./, 12]];
  for (const [re, mon] of abbr) if (re.test(n)) return (parseInt(n.match(/(\d{4})/)?.[1] || '0', 10)) * 100 + mon;
  const iso = n.match(/(20\d{2}|25\d{2})[-_/](\d{1,2})/);
  return iso ? parseInt(iso[1], 10) * 100 + parseInt(iso[2], 10) : 0;
}

function pickDwg(files) {
  const dwgs = files.filter((f) => /\.dwg$/i.test(f.name || '') && f.mimeType !== FOLDER_MIME).sort(byModifiedDesc);
  return dwgs.find((f) => !MOBILE_NAME.test(f.name)) || dwgs[0] || null;
}

const HEADERS = SITE_URL ? { Referer: `${SITE_URL}/` } : {};

async function api(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch {}
    throw new Error(`Drive API: ${msg}`);
  }
  return res.json();
}

async function listChildren(id) {
  const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
  const j = await api(`${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(KEY)}`);
  return j.files || [];
}

async function resolveLatest() {
  const meta = await api(`${API}/${FOLDER_ID}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true&key=${encodeURIComponent(KEY)}`);
  if (meta.mimeType !== FOLDER_MIME) return meta;
  const children = await listChildren(FOLDER_ID);
  const folders = children.filter((f) => f.mimeType === FOLDER_MIME);
  const months = folders.filter((f) => monthKey(f.name) > 0).sort((a, b) => monthKey(b.name) - monthKey(a.name) || ts(b) - ts(a));
  const tryFolders = months.length ? months : folders.sort((a, b) => monthKey(b.name) - monthKey(a.name));
  let fromMonth = null;
  for (const f of tryFolders) {
    const inner = await listChildren(f.id);
    const pick = pickDwg(inner);
    if (pick) { fromMonth = pick; break; }
  }
  const fromRoot = pickDwg(children);
  const best = fromMonth && fromRoot ? (ts(fromRoot) > ts(fromMonth) ? fromRoot : fromMonth) : fromMonth || fromRoot;
  if (!best) throw new Error('ไม่พบไฟล์ .dwg');
  return best;
}

function readPrevMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    if (m && fs.existsSync(path.join(MAP_DIR, 'tiles')) && fs.existsSync(path.join(MAP_DIR, 'index.json'))) return m;
  } catch {}
  return null;
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  setOutput('map_changed', 'false');
  if (!KEY) { console.log('::warning::ไม่มี GOOGLE_API_KEY'); return; }

  const prev = readPrevMeta();
  const latest = await resolveLatest();
  console.log(`ล่าสุด: ${latest.name} gen=${GENERATOR_VERSION}`);

  if (!process.env.FORCE_MAP && prev && prev.generatorVersion === GENERATOR_VERSION
      && prev.sourceId === latest.id && prev.sourceModified === latest.modifiedTime) {
    console.log('ไม่เปลี่ยน');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadmap-'));
  const dwg = path.join(tmp, 'in.dwg');
  const dxf = path.join(tmp, 'out.dxf');
  const pdf = path.join(tmp, 'out.pdf');
  const texts = path.join(tmp, 'texts.json');
  const outMap = path.join(tmp, 'map');

  const res = await fetch(`${API}/${latest.id}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(KEY)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  fs.writeFileSync(dwg, Buffer.from(await res.arrayBuffer()));

  await dwgToDxf(dwg, dxf);

  if (process.env.DIAG_DIR) {
    // โหมดวินิจฉัย: เรนเดอร์ภาพบริเวณหนึ่งด้วยค่าความหนาเส้นหลายแบบ แล้วจบ (ไม่แตะกระเบื้องจริง)
    console.log('วินิจฉัย: เรนเดอร์ภาพเทียบค่าความหนาเส้น...');
    execFileSync('python3', [path.join(HERE, 'diag.py'), dxf, process.env.DIAG_DIR], { stdio: 'inherit' });
    return;
  }

  execFileSync('python3', [path.join(HERE, 'dxf_to_pdf.py'), dxf, pdf, texts], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PDF_MIN_LINEWEIGHT_MM: process.env.PDF_MIN_LINEWEIGHT_MM || '0.01',
      PDF_LINEWEIGHT_SCALING: process.env.PDF_LINEWEIGHT_SCALING || '0.35',
      PDF_MAX_LINEWEIGHT_MM: process.env.PDF_MAX_LINEWEIGHT_MM || '0.25',
      PDF_ENTITY_MAX_LW: process.env.PDF_ENTITY_MAX_LW || '25',
    },
  });

  execFileSync('python3', [path.join(HERE, 'make-tiles.py'), pdf, texts, outMap], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TILE_TARGET_TEXT_PX: process.env.TILE_TARGET_TEXT_PX || '14',
      TILE_MAX_WIDTH_PX: process.env.TILE_MAX_WIDTH_PX || '65536',
      TILE_WEBP_LOSSLESS: process.env.TILE_WEBP_LOSSLESS || '1',
      TILE_LINE_BOOST_BASE: process.env.TILE_LINE_BOOST_BASE || '1.12',
      TILE_LINE_BOOST_MAX: process.env.TILE_LINE_BOOST_MAX || '1.85',
    },
  });

  const meta = JSON.parse(fs.readFileSync(path.join(outMap, 'meta.json'), 'utf8'));
  Object.assign(meta, {
    sourceId: latest.id,
    sourceName: latest.name,
    sourceModified: latest.modifiedTime,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(outMap, 'meta.json'), JSON.stringify(meta));

  fs.rmSync(MAP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(MAP_DIR), { recursive: true });
  fs.cpSync(outMap, MAP_DIR, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  setOutput('map_changed', 'true');
  console.log(`ok tiles=${meta.tiles} gen=${GENERATOR_VERSION}`);
}

main().catch((e) => console.log(`::warning::${e.message}`));
