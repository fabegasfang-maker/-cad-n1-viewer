/**
 * หน้าแรก: ปุ่ม "ดาวน์โหลดไฟล์แผนผังล่าสุด"
 * ใช้ตรรกะเดียวกับตัวดู (เลือกโฟลเดอร์เดือนล่าสุด → ไฟล์ .dwg ล่าสุด)
 */
import { downloadPublicDriveCadToDevice, DRIVE_API_KEY } from './services/drivePublic';

// ต้องตรงกับ DEFAULT_DRIVE_FILE_ID ของตัวดู (scripts/restore-phase-a.mjs)
const DEFAULT_DRIVE_FOLDER_ID = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';

function getFolderId(): string {
  try {
    return localStorage.getItem('cad_default_drive_file_id') || DEFAULT_DRIVE_FOLDER_ID;
  } catch {
    return DEFAULT_DRIVE_FOLDER_ID;
  }
}

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
