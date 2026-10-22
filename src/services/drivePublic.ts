/**
 * ดึงไฟล์/โฟลเดอร์ Google Drive ที่แชร์เป็น "ทุกคนที่มีลิงก์" โดยไม่ต้องล็อกอิน
 * ใช้ Google Drive API + API key (ทำงานในเบราว์เซอร์ได้ เพราะ googleapis.com รองรับ CORS)
 */
const API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY as string) || '';

async function apiJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch {}
    if (res.status === 403) msg += ' (ตรวจว่าเปิด Drive API และตั้ง API key ถูกต้อง)';
    if (res.status === 404) msg = 'ไม่พบไฟล์/โฟลเดอร์ หรือยังไม่ได้แชร์เป็น "ทุกคนที่มีลิงก์"';
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchPublicDriveCad(
  id: string,
  onStage?: (s: string) => void
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  if (!DRIVE_API_KEY) {
    throw new Error('ยังไม่ได้ตั้งค่า API key (VITE_GOOGLE_API_KEY) สำหรับโหลดจาก Google Drive');
  }
  const key = `key=${encodeURIComponent(DRIVE_API_KEY)}`;

  onStage?.('กำลังตรวจสอบไฟล์บน Google Drive...');
  let meta = await apiJson(`${API}/${id}?fields=id,name,mimeType,size&supportsAllDrives=true&${key}`);

  if (meta.mimeType === 'application/vnd.google-apps.folder') {
    onStage?.('กำลังค้นหาไฟล์ CAD ในโฟลเดอร์...');
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const list = await apiJson(
      `${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&${key}`
    );
    const cad = (list.files || []).find((f: any) => /\.(dxf|dwg)$/i.test(f.name));
    if (!cad) throw new Error('ไม่พบไฟล์ .dxf / .dwg ในโฟลเดอร์นี้');
    meta = cad;
  }

  const mb = meta.size ? ` (${(Number(meta.size) / 1048576).toFixed(0)} MB)` : '';
  onStage?.(`กำลังดาวน์โหลด ${meta.name}${mb}...`);
  const res = await fetch(`${API}/${meta.id}?alt=media&supportsAllDrives=true&${key}`);
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
  return { buffer: await res.arrayBuffer(), filename: meta.name };
}
