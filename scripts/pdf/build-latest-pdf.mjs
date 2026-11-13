/**
 * สร้าง public/latest.pdf จากไฟล์ DWG ล่าสุดบน Google Drive (รันใน GitHub Actions ก่อน build)
 *
 *   1) หาไฟล์ .dwg ล่าสุด (โฟลเดอร์เดือนล่าสุด → ไฟล์ล่าสุด) ด้วยกติกาเดียวกับตัวดู
 *   2) ถ้ายังเป็นไฟล์เดิมกับ PDF ที่เผยแพร่อยู่แล้ว → ใช้ PDF เดิม ไม่แปลงซ้ำ
 *   3) ไม่เช่นนั้น: ดาวน์โหลด → DWG→DXF (LibreDWG wasm) → PDF (ezdxf + PyMuPDF)
 *   4) ถ้าขั้นตอนใดพัง จะคง PDF เดิมไว้ (ถ้ามี) เพื่อไม่ให้ไฟล์หายจากหน้าเว็บ
 *
 * env: GOOGLE_API_KEY (จำเป็น), DRIVE_FOLDER_ID (ไม่ใส่ = ค่าเริ่มต้นเดียวกับหน้าแรก),
 *      SITE_URL (เช่น https://user.github.io/repo — ใช้ดึง PDF เดิมมาเทียบ)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dwgToDxf } from './dwg-to-dxf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../public');
const PDF_PATH = path.join(OUT_DIR, 'latest.pdf');
const META_PATH = path.join(OUT_DIR, 'latest.json');

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KEY = process.env.GOOGLE_API_KEY || '';
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
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

async function fetchPrevious() {
  if (!SITE_URL) return null;
  try {
    const m = await fetch(`${SITE_URL}/latest.json`, { cache: 'no-store' });
    const p = await fetch(`${SITE_URL}/latest.pdf`, { cache: 'no-store' });
    if (!m.ok || !p.ok) return null;
    const prevMeta = await m.json();
    const buf = Buffer.from(await p.arrayBuffer());
    if (buf.length < 1000 || buf.subarray(0, 4).toString() !== '%PDF') return null;
    return { meta: prevMeta, pdf: buf };
  } catch {
    return null;
  }
}

async function main() {
  if (!KEY) { console.log('::warning::ไม่มี GOOGLE_API_KEY → ข้ามการสร้าง PDF'); return; }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const prev = await fetchPrevious();
  if (prev) {
    // วาง PDF เดิมไว้ก่อน เป็นตัวสำรองหากขั้นตอนต่อไปพัง
    fs.writeFileSync(PDF_PATH, prev.pdf);
    fs.writeFileSync(META_PATH, JSON.stringify(prev.meta, null, 2));
    console.log(`พบ PDF เดิม: ${prev.meta.sourceName} (${prev.meta.sourceModified})`);
  }

  const latest = await resolveLatest();
  console.log(`ไฟล์ล่าสุดบน Drive: ${latest.name} (${latest.modifiedTime}, ${(Number(latest.size || 0) / 1048576).toFixed(1)} MB)`);

  if (!process.env.FORCE_PDF && prev && prev.meta.sourceId === latest.id && prev.meta.sourceModified === latest.modifiedTime) {
    console.log('ไฟล์ยังไม่เปลี่ยน → ใช้ PDF เดิม');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadpdf-'));
  const dwg = path.join(tmp, 'in.dwg');
  const dxf = path.join(tmp, 'out.dxf');
  const pdf = path.join(tmp, 'out.pdf');

  console.log('ดาวน์โหลด DWG...');
  const res = await fetch(`${API}/${latest.id}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(KEY)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`ดาวน์โหลด DWG ไม่สำเร็จ (HTTP ${res.status})`);
  fs.writeFileSync(dwg, Buffer.from(await res.arrayBuffer()));

  console.log('DWG → DXF...');
  await dwgToDxf(dwg, dxf);

  console.log('DXF → PDF...');
  execFileSync('python3', [path.join(HERE, 'dxf_to_pdf.py'), dxf, pdf], { stdio: 'inherit' });

  fs.copyFileSync(pdf, PDF_PATH);
  fs.writeFileSync(META_PATH, JSON.stringify({
    sourceId: latest.id,
    sourceName: latest.name,
    sourceModified: latest.modifiedTime,
    generatedAt: new Date().toISOString(),
    pdfBytes: fs.statSync(PDF_PATH).size,
  }, null, 2));
  console.log('สร้าง latest.pdf เรียบร้อย');
}

main().catch((e) => {
  // ไม่ทำให้ deploy ทั้งเว็บล้ม: คง PDF เดิม (ถ้ามี) แล้วแจ้งเตือนในหน้า Actions
  console.log(`::warning::สร้าง PDF ไม่สำเร็จ: ${e.message}`);
});
