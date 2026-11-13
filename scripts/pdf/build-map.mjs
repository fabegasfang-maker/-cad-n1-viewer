/**
 * สร้างกระเบื้องแผนที่ (public/map) จากไฟล์ DWG ล่าสุดบน Google Drive — รันใน GitHub Actions ก่อน build
 *
 *   1) หาไฟล์ .dwg ล่าสุด (โฟลเดอร์เดือนล่าสุด → ไฟล์ล่าสุด) ด้วยกติกาเดียวกับตัวดู
 *   2) ถ้ายังเป็นไฟล์เดิมกับกระเบื้องที่มีอยู่แล้วใน public/map → ไม่ทำซ้ำ
 *   3) ไม่เช่นนั้น: ดาวน์โหลด → DWG→DXF (LibreDWG wasm) → PDF A0 (ezdxf + PyMuPDF)
 *      → กระเบื้องภาพหลายระดับซูม + ดัชนีค้นหา (make-tiles.py)
 *   4) เขียนทับ public/map เฉพาะเมื่อสร้างสำเร็จทั้งหมด ถ้าพังจะคงของเดิมไว้
 *   5) แจ้ง map_changed=true ผ่าน $GITHUB_OUTPUT เพื่อให้ workflow บันทึกลง branch map-tiles
 *
 * env: GOOGLE_API_KEY (จำเป็น), DRIVE_FOLDER_ID (ไม่ใส่ = ค่าเริ่มต้นเดียวกับหน้าแรก),
 *      SITE_URL (ใช้เป็น Referer เพราะ key จำกัดตามเว็บ), FORCE_MAP=1 (สร้างใหม่เสมอ)
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
// เพิ่มเลขนี้ทุกครั้งที่สูตรแปลง/สร้างกระเบื้องเปลี่ยน เพื่อให้สร้างใหม่แม้ไฟล์ใน Drive ไม่เปลี่ยน
const GENERATOR_VERSION = 4;
const MOBILE_NAME = /mobile|mob\b|phone|เล็ก|มือถือ|_mobile/i;

const THAI_MONTHS = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};

// ---- กติกาเลือกไฟล์: เหมือน src/services/drivePublic.ts (ฝั่งเดสก์ท็อป) ----
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
  // PDF ใช้ผังเต็ม: เลี่ยงไฟล์ชื่อ mobile ถ้ามีไฟล์อื่น
  return dwgs.find((f) => !MOBILE_NAME.test(f.name)) || dwgs[0] || null;
}

// API key ของโปรเจกต์นี้จำกัดการเรียกตามเว็บไซต์ (HTTP referrer) จึงต้องส่ง Referer ของเว็บเราไปด้วย
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
  if (meta.mimeType !== FOLDER_MIME) return meta; // ตั้งค่าเป็นไฟล์ตรงๆ
  const children = await listChildren(FOLDER_ID);
  const folders = children.filter((f) => f.mimeType === FOLDER_MIME);
  console.log(`--- โฟลเดอร์ย่อยใน Drive (${folders.length}) เรียงตามกติกา "เดือนล่าสุด" ---`);
  for (const f of [...folders].sort((a, b) => monthKey(b.name) - monthKey(a.name) || ts(b) - ts(a)).slice(0, 8)) {
    console.log(`  [key=${monthKey(f.name)}] ${f.name}  (แก้ไข ${f.modifiedTime})`);
  }
  const months = folders.filter((f) => monthKey(f.name) > 0).sort((a, b) => monthKey(b.name) - monthKey(a.name) || ts(b) - ts(a));
  const tryFolders = months.length ? months : folders.sort((a, b) => monthKey(b.name) - monthKey(a.name));
  let fromMonth = null;
  for (const f of tryFolders) {
    const inner = await listChildren(f.id);
    console.log(`--- ในโฟลเดอร์ "${f.name}" ---`);
    for (const x of inner.filter((y) => /\.(dwg|dxf)$/i.test(y.name || '')).slice(0, 25)) {
      console.log(`  ${x.name}  (${(Number(x.size || 0) / 1048576).toFixed(1)} MB, แก้ไข ${x.modifiedTime})`);
    }
    const pick = pickDwg(inner);
    if (pick) { fromMonth = pick; break; }
  }
  const fromRoot = pickDwg(children);
  console.log(`--- ไฟล์ .dwg ที่รากโฟลเดอร์: ${fromRoot ? `${fromRoot.name} (แก้ไข ${fromRoot.modifiedTime})` : 'ไม่มี'}`);
  const best = fromMonth && fromRoot ? (ts(fromRoot) > ts(fromMonth) ? fromRoot : fromMonth) : fromMonth || fromRoot;
  if (!best) throw new Error('ไม่พบไฟล์ .dwg ในโฟลเดอร์ Drive');
  return best;
}

function readPrevMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    // ต้องมีกระเบื้องจริงอยู่ด้วย
    if (m && fs.existsSync(path.join(MAP_DIR, 'tiles')) && fs.existsSync(path.join(MAP_DIR, 'index.json'))) return m;
  } catch {}
  return null;
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  setOutput('map_changed', 'false');
  if (!KEY) { console.log('::warning::ไม่มี GOOGLE_API_KEY → ข้ามการสร้างแผนที่'); return; }

  const prev = readPrevMeta();
  if (prev) console.log(`พบกระเบื้องเดิม: ${prev.sourceName} (${prev.sourceModified}, ${prev.tiles} ไฟล์)`);

  const latest = await resolveLatest();
  console.log(`ไฟล์ล่าสุดบน Drive: ${latest.name} (${latest.modifiedTime}, ${(Number(latest.size || 0) / 1048576).toFixed(1)} MB)`);

  if (!process.env.FORCE_MAP && prev && prev.generatorVersion === GENERATOR_VERSION
      && prev.sourceId === latest.id && prev.sourceModified === latest.modifiedTime) {
    console.log('ไฟล์ยังไม่เปลี่ยน → ใช้กระเบื้องเดิม');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadmap-'));
  const dwg = path.join(tmp, 'in.dwg');
  const dxf = path.join(tmp, 'out.dxf');
  const pdf = path.join(tmp, 'out.pdf');
  const texts = path.join(tmp, 'texts.json');
  const outMap = path.join(tmp, 'map');

  console.log('ดาวน์โหลด DWG...');
  const res = await fetch(`${API}/${latest.id}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(KEY)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`ดาวน์โหลด DWG ไม่สำเร็จ (HTTP ${res.status})`);
  fs.writeFileSync(dwg, Buffer.from(await res.arrayBuffer()));

  console.log('DWG → DXF...');
  await dwgToDxf(dwg, dxf);

  console.log('DXF → PDF (A0)...');
  execFileSync('python3', [path.join(HERE, 'dxf_to_pdf.py'), dxf, pdf, texts], { stdio: 'inherit' });

  console.log('PDF → กระเบื้องแผนที่...');
  execFileSync('python3', [path.join(HERE, 'make-tiles.py'), pdf, texts, outMap], { stdio: 'inherit' });

  const meta = JSON.parse(fs.readFileSync(path.join(outMap, 'meta.json'), 'utf8'));
  Object.assign(meta, {
    sourceId: latest.id,
    sourceName: latest.name,
    sourceModified: latest.modifiedTime,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(outMap, 'meta.json'), JSON.stringify(meta));

  // สำเร็จทั้งหมดแล้วค่อยแทนที่ของเดิม
  fs.rmSync(MAP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(MAP_DIR), { recursive: true });
  fs.cpSync(outMap, MAP_DIR, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  setOutput('map_changed', 'true');
  console.log(`สร้างแผนที่เรียบร้อย: ${meta.tiles} กระเบื้อง, ซูม 0..${meta.maxZoom}`);
}

main().catch((e) => {
  // ไม่ทำให้ deploy ทั้งเว็บล้ม: คงกระเบื้องเดิม (ถ้ามี) แล้วแจ้งเตือนในหน้า Actions
  console.log(`::warning::สร้างแผนที่ไม่สำเร็จ: ${e.message}`);
});
