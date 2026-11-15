/**
 * หน้าแรก: ปุ่ม "ดาวน์โหลดไฟล์แผนผังล่าสุด"
 * ใช้ตรรกะเดียวกับตัวดู (เลือกโฟลเดอร์เดือนล่าสุด → ไฟล์ .dwg ล่าสุด)
 */
import {
  downloadPublicDriveCadToDevice,
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

// ---------- วันที่ PDF ที่เรนเดอร์ล่าสุด (ใต้หัวข้อ) ----------
const fileDateEl = document.getElementById('file-date') as HTMLElement | null;

async function refreshLatestFileDate() {
  if (!fileDateEl) return;
  fileDateEl.textContent = 'กำลังตรวจสอบแผนผัง PDF ล่าสุด…';
  try {
    // วันที่จากรอบเรนเดอร์ PDF/กระเบื้องล่าสุด (map/meta.json) ไม่ใช่วันที่ไฟล์บน Drive
    const res = await fetch('map/meta.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('no meta');
    const meta = await res.json();
    const when = formatModifiedTh(meta.generatedAt || meta.sourceModified);
    const name = meta.sourceName ? String(meta.sourceName).replace(/\.dwg$/i, '') : '';
    if (when && name) {
      fileDateEl.textContent = `PDF ล่าสุด: ${when}`;
      fileDateEl.title = name;
    } else if (when) {
      fileDateEl.textContent = `PDF ล่าสุด: ${when}`;
    } else {
      fileDateEl.textContent = 'ยังไม่พบวันที่เรนเดอร์ PDF';
    }
  } catch {
    fileDateEl.textContent = 'ยังไม่พบวันที่เรนเดอร์ PDF';
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
