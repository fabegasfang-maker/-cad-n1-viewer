/**
 * ดึงไฟล์/โฟลเดอร์ Google Drive ที่แชร์เป็น "ทุกคนที่มีลิงก์" โดยไม่ต้องล็อกอิน
 * ใช้ Google Drive API + API key (ทำงานในเบราว์เซอร์ได้ เพราะ googleapis.com รองรับ CORS)
 */
const API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY as string) || '';

/** มือถือ/แท็บเล็ต: จอเล็กหรือหน้าจอสัมผัสหลัก */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (window.matchMedia?.('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 820));

/** ขนาดไฟล์สูงสุดที่ยอมให้มือถือโหลด (ไฟล์ใหญ่กว่านี้มักทำให้เบราว์เซอร์ค้าง/รีโหลดเอง) */
const MOBILE_MAX_BYTES = 40 * 1024 * 1024;
const MOBILE_NAME = /mobile|mob\b|phone|เล็ก|มือถือ/i;

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
    onStage?.('กำลังค้นหาไฟล์ CAD (.dwg / .dxf) ในโฟลเดอร์...');
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const list = await apiJson(
      `${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&${key}`
    );
    const allFiles: any[] = list.files || [];
    // ค้นหาไฟล์ .dwg ก่อน โดยเรียงตาม modifiedTime desc (ไฟล์ที่อัปเดตล่าสุด)
    const dwgs: any[] = allFiles.filter((f: any) => /\.dwg$/i.test(f.name));
    const dxfs: any[] = allFiles.filter((f: any) => /\.dxf$/i.test(f.name));

    const candidates = dwgs.length > 0 ? dwgs : dxfs;
    if (!candidates.length) throw new Error('ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้');

    // มือถือ: เลือกไฟล์ที่ชื่อมีคำว่า mobile ก่อน, คอม: เลือกไฟล์ที่ไม่ใช่ mobile ก่อน (ไฟล์ล่าสุดนำหน้า)
    const preferred = candidates.filter((f) => MOBILE_NAME.test(f.name) === IS_MOBILE);
    meta = preferred[0] || (IS_MOBILE ? candidates.slice().sort((a, b) => Number(a.size) - Number(b.size))[0] : candidates[0]);
  }

  if (IS_MOBILE && meta.size && Number(meta.size) > MOBILE_MAX_BYTES) {
    throw new Error(
      `ไฟล์ "${meta.name}" ใหญ่ ${(Number(meta.size) / 1048576).toFixed(0)} MB เกินกว่ามือถือจะเปิดไหว (เสี่ยงค้าง) ` +
        'กรุณาเปิดจากคอมพิวเตอร์ หรือให้ผู้ดูแลเพิ่มไฟล์ฉบับย่อสำหรับมือถือ (ตั้งชื่อลงท้ายด้วย _mobile.dxf) ในโฟลเดอร์ Drive'
    );
  }

  const mb = meta.size ? ` (${(Number(meta.size) / 1048576).toFixed(0)} MB)` : '';
  onStage?.(`กำลังดาวน์โหลด ${meta.name}${mb}...`);
  const res = await fetch(`${API}/${meta.id}?alt=media&supportsAllDrives=true&${key}`);
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
  return { buffer: await res.arrayBuffer(), filename: meta.name };
}
