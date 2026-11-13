/**
 * หน้าแรก: ปุ่ม "ดาวน์โหลดไฟล์แผนผังล่าสุด"
 * ใช้ตรรกะเดียวกับตัวดู (เลือกโฟลเดอร์เดือนล่าสุด → ไฟล์ .dwg ล่าสุด)
 */
import { downloadPublicDriveCadToDevice, DRIVE_API_KEY } from './services/drivePublic';

// ต้องตรงกับ DEFAULT_DRIVE_FILE_ID ของตัวดู (scripts/restore-phase-a.mjs)
const DEFAULT_DRIVE_FOLDER_ID = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';

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

// ---------- ตั้งค่า (ปุ่มล่างขวา) ----------
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
    e.preventDefault(); // ไม่ปิดกล่องเมื่อค่าไม่ถูกต้อง
    setHint('อ่านลิงก์ไม่ได้ ตรวจว่าเป็นลิงก์ Google Drive หรือ ID ที่ถูกต้อง', true);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  setStatus('บันทึกตำแหน่งไฟล์ใหม่แล้ว ตัวดูและปุ่มดาวน์โหลดจะใช้ค่านี้');
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

  // ไม่มี API key ตอน build → ไม่สามารถค้นหาไฟล์ล่าสุดอัตโนมัติ ส่งไปที่โฟลเดอร์ Drive แทน
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
