/**
 * หน้าแรก: ปุ่ม "ดาวน์โหลดไฟล์แผนผังล่าสุด"
 * ใช้ตรรกะเดียวกับตัวดู (เลือกโฟลเดอร์เดือนล่าสุด → ไฟล์ .dwg ล่าสุด)
 */
import {
  downloadPublicDriveCadToDevice,
  resolvePublicDriveCadMeta,
  DRIVE_API_KEY,
} from './services/drivePublic';

function formatModifiedTh(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// ต้องตรงกับ DEFAULT_DRIVE_FILE_ID ของตัวดู (scripts/restore-phase-a.mjs)
const DEFAULT_DRIVE_FOLDER_ID = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';

/** รหัสเปิดเมนูตั้งค่า (เปลี่ยนได้ที่นี่) */
const SETTINGS_PIN = 'n1cad';

function getFolderId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_DRIVE_FOLDER_ID;
  } catch {
    return DEFAULT_DRIVE_FOLDER_ID;
  }
}

const STORAGE_KEY = 'cad_default_drive_file_id';

/** รับลิงก์ Google Drive (โฟลเดอร์/ไฟล์) หรือ ID ล้วน → คืน ID หรือ null ถ้าอ่านไม่ได้ */
export function parseDriveId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m =
    s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) ||
    s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
    s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

// ---------- วันที่ไฟล์ใต้ปุ่มทั้ง 3 ----------
const fileDateEl = document.getElementById('file-date') as HTMLElement | null;

function setStamp(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function stripExt(name?: string): string {
  return name ? String(name).replace(/\.(dwg|dxf)$/i, '') : '';
}

/** ข้อมูลไฟล์ต้นทางจากรอบเรนเดอร์ PDF (map/meta.json) ใช้เป็นค่าสำรองของ CAD/ดาวน์โหลดด้วย */
let pdfSource: { name: string; modified: string } | null = null;

async function refreshLatestFileDate() {
  if (fileDateEl) fileDateEl.textContent = 'กำลังตรวจสอบแผนผัง PDF ล่าสุด…';
  setStamp('stamp-pdf', 'กำลังตรวจสอบวันเวลา…');
  setStamp('stamp-cad', 'กำลังตรวจสอบวันเวลา…');
  setStamp('stamp-download', 'กำลังตรวจสอบวันเวลา…');

  // 1) PDF: วันเวลาที่เรนเดอร์ PDF/กระเบื้องล่าสุด (map/meta.json) ไม่ใช่วันที่ไฟล์บน Drive
  try {
    const res = await fetch('map/meta.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('no meta');
    const meta = await res.json();
    const rendered = formatModifiedTh(meta.generatedAt);
    const srcWhen = formatModifiedTh(meta.sourceModified);
    const name = stripExt(meta.sourceName);
    pdfSource = name || srcWhen ? { name, modified: srcWhen } : null;
    if (fileDateEl) {
      fileDateEl.textContent = rendered ? `PDF ล่าสุด: ${rendered}` : 'ยังไม่พบวันที่เรนเดอร์ PDF';
      if (name) fileDateEl.title = name;
    }
    const parts = [
      name ? `จากไฟล์ ${name}` : '',
      srcWhen ? `(ไฟล์ต้นฉบับอัปเดต ${srcWhen})` : '',
    ].filter(Boolean);
    setStamp(
      'stamp-pdf',
      rendered
        ? `เรนเดอร์ PDF เมื่อ ${rendered}${parts.length ? ' · ' + parts.join(' ') : ''}`
        : 'ยังไม่พบวันเวลาที่เรนเดอร์ PDF'
    );
  } catch {
    if (fileDateEl) fileDateEl.textContent = 'ยังไม่พบวันที่เรนเดอร์ PDF';
    setStamp('stamp-pdf', 'ยังไม่พบวันเวลาที่เรนเดอร์ PDF');
  }

  // 2) CAD และ ดาวน์โหลด: ไฟล์ .dwg ล่าสุดบน Google Drive (ไฟล์เดียวกับที่ตัวดู CAD เปิด / ปุ่มดาวน์โหลดบันทึก)
  try {
    if (!DRIVE_API_KEY) throw new Error('no key');
    const meta = await resolvePublicDriveCadMeta(getFolderId(), undefined, {
      forMobileDownload: true,
    });
    const when = formatModifiedTh(meta.modifiedTime);
    const text = `ไฟล์ ${stripExt(meta.name)}${when ? ` · อัปเดตบน Drive ${when}` : ''}`;
    setStamp('stamp-cad', text);
    setStamp('stamp-download', text);
  } catch {
    // ไม่มี API key / เรียก Drive ไม่ได้ → ใช้ข้อมูลไฟล์ต้นทางจากรอบเรนเดอร์ PDF แทน
    const text = pdfSource
      ? `ไฟล์ ${pdfSource.name}${pdfSource.modified ? ` · อัปเดต ${pdfSource.modified}` : ''} (ตามรอบเรนเดอร์ล่าสุด)`
      : 'ยังไม่พบวันเวลาของไฟล์';
    setStamp('stamp-cad', text);
    setStamp('stamp-download', text);
  }
}

void refreshLatestFileDate();

// ---------- ตั้งค่า (ปุ่มล่างขวา) — ต้องใส่รหัส ----------
const dialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const driveInput = document.getElementById('drive-input') as HTMLInputElement;
const driveHint = document.getElementById('drive-hint') as HTMLElement;
const HINT_DEFAULT =
  'ใช้เมื่อย้ายที่เก็บแผนผัง วางลิงก์โฟลเดอร์ใหม่ได้เลย ต้องแชร์เป็น "ทุกคนที่มีลิงก์"';

function setHint(text: string, isError = false) {
  driveHint.textContent = text;
  driveHint.classList.toggle('error', isError);
}

document.getElementById('btn-settings')!.addEventListener('click', () => {
  const pin = window.prompt('ใส่รหัสเพื่อเปิดตั้งค่า');
  if (pin === null) return;
  if (pin.trim() !== SETTINGS_PIN) {
    setStatus('รหัสไม่ถูกต้อง', true);
    return;
  }
  driveInput.value = getFolderId();
  setHint(HINT_DEFAULT);
  dialog.showModal();
});

document.getElementById('settings-cancel')!.addEventListener('click', () => dialog.close());

document.getElementById('settings-reset')!.addEventListener('click', () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  driveInput.value = DEFAULT_DRIVE_FOLDER_ID;
  setHint('คืนค่าเริ่มต้นแล้ว (กด "บันทึก" หรือ "ยกเลิก" เพื่อปิด)');
});

document.getElementById('settings-form')!.addEventListener('submit', (e) => {
  const id = parseDriveId(driveInput.value);
  if (!id) {
    e.preventDefault();
    setHint('อ่านลิงก์ไม่ได้ ตรวจว่าเป็นลิงก์ Google Drive หรือ ID ที่ถูกต้อง', true);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  setStatus('บันทึกตำแหน่งไฟล์ใหม่แล้ว ตัวดูและปุ่มดาวน์โหลดจะใช้ค่านี้');
  void refreshLatestFileDate();
});

const btn = document.getElementById('btn-download') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function showDriveFallback(message: string) {
  const folderUrl = `https://drive.google.com/drive/folders/${encodeURIComponent(getFolderId())}`;
  statusEl.classList.add('error');
  statusEl.textContent = `${message} `;
  const a = document.createElement('a');
  a.href = folderUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'เปิดโฟลเดอร์ใน Google Drive';
  statusEl.appendChild(a);
}

btn.addEventListener('click', async () => {
  if (btn.disabled) return;

  if (!DRIVE_API_KEY) {
    window.open(
      `https://drive.google.com/drive/folders/${encodeURIComponent(getFolderId())}`,
      '_blank',
      'noopener'
    );
    setStatus('เปิดโฟลเดอร์ Google Drive ในแท็บใหม่แล้ว เลือกไฟล์ล่าสุดเพื่อดาวน์โหลดได้เลย');
    return;
  }

  btn.disabled = true;
  setStatus('กำลังค้นหาไฟล์ล่าสุด...');
  try {
    const { filename, sizeBytes } = await downloadPublicDriveCadToDevice(getFolderId(), (s) =>
      setStatus(s)
    );
    setStatus(`บันทึกแล้ว: ${filename} (${(sizeBytes / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    showDriveFallback(err instanceof Error ? err.message : 'ดาวน์โหลดไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
});
