/**
 * ดึงไฟล์/โฟลเดอร์ Google Drive ที่แชร์เป็น "ทุกคนที่มีลิงก์" โดยไม่ต้องล็อกอิน
 * ใช้ Google Drive API + API key (ทำงานในเบราว์เซอร์ได้ เพราะ googleapis.com รองรับ CORS)
 *
 * กฎเลือกไฟล์เมื่อ id เป็นโฟลเดอร์:
 * - คอมพิวเตอร์: เลือก .dwg ที่ modifiedTime ล่าสุดก่อน (เช่น 28 ต.ค. ก่อน 13 ต.ค.)
 *   ข้ามไฟล์ชื่อมีคำว่า mobile ถ้ามีตัวเลือกอื่น
 * - มือถือ: เลือกไฟล์ชื่อมี mobile ก่อน ไม่งั้นเลือกไฟล์เล็กสุด
 * - ถ้าไม่มี .dwg เลย ค่อยใช้ .dxf ตามกฎเดียวกัน
 */
import { isMobileDevice, getMobileMaxUploadBytes } from '../utils/device';

const API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY as string) || '';

/** มือถือ/แท็บเล็ต รวม iPadOS ที่รายงานเป็น Mac */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' && isMobileDevice();

/** ชื่อไฟล์ฉบับย่อสำหรับมือถือ — คอมจะหลีกเลี่ยงไฟล์เหล่านี้ */
const MOBILE_NAME = /mobile|mob\b|phone|เล็ก|มือถือ|_mobile/i;

type DriveFileMeta = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string | number;
  modifiedTime?: string;
};

/** เรียง modifiedTime ใหม่ → เก่า (ไม่มีวันที่ไปท้าย) */
function sortByModifiedDesc(files: DriveFileMeta[]): DriveFileMeta[] {
  return files.slice().sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    if (tb !== ta) return tb - ta;
    // เสมอกัน: ชื่อใหม่กว่า (เลขในชื่อ) ไม่บังคับ — คงลำดับเดิม
    return String(b.name || '').localeCompare(String(a.name || ''), 'th');
  });
}

function formatModifiedTh(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

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

/**
 * เลือกไฟล์ CAD จากรายการในโฟลเดอร์
 * คอม: DWG ล่าสุด (ไม่ใช่ฉบับ mobile) → ไม่งั้น DWG ล่าสุด → ไม่งั้น DXF ล่าสุด
 * มือถือ: ชื่อ mobile ก่อน → ไฟล์เล็กสุด
 */
export function pickLatestCadFile(allFiles: DriveFileMeta[], mobile = IS_MOBILE): DriveFileMeta {
  const dwgs = sortByModifiedDesc(allFiles.filter((f) => /\.dwg$/i.test(f.name || '')));
  const dxfs = sortByModifiedDesc(allFiles.filter((f) => /\.dxf$/i.test(f.name || '')));

  if (mobile) {
    const mobileNamed = sortByModifiedDesc(
      [...dwgs, ...dxfs].filter((f) => MOBILE_NAME.test(f.name || ''))
    );
    if (mobileNamed.length) return mobileNamed[0];
    // ไม่มีฉบับ mobile → เลือกไฟล์เล็กสุด (กัน OOM)
    const all = [...dwgs, ...dxfs].sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
    if (!all.length) throw new Error('ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้');
    return all[0];
  }

  // Desktop: เน้น DWG ล่าสุด — ข้ามไฟล์ชื่อ mobile ถ้ามีตัวเลือกอื่น
  const desktopDwgs = dwgs.filter((f) => !MOBILE_NAME.test(f.name || ''));
  if (desktopDwgs.length) return desktopDwgs[0]; // เรียง modifiedTime แล้ว
  if (dwgs.length) return dwgs[0];

  const desktopDxfs = dxfs.filter((f) => !MOBILE_NAME.test(f.name || ''));
  if (desktopDxfs.length) return desktopDxfs[0];
  if (dxfs.length) return dxfs[0];

  throw new Error('ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้');
}

export async function fetchPublicDriveCad(
  id: string,
  onStage?: (s: string) => void
): Promise<{ buffer: ArrayBuffer; filename: string; modifiedTime?: string }> {
  if (!DRIVE_API_KEY) {
    throw new Error('ยังไม่ได้ตั้งค่า API key (VITE_GOOGLE_API_KEY) สำหรับโหลดจาก Google Drive');
  }
  const key = `key=${encodeURIComponent(DRIVE_API_KEY)}`;

  onStage?.('กำลังตรวจสอบไฟล์บน Google Drive...');
  let meta: DriveFileMeta = await apiJson(
    `${API}/${id}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true&${key}`
  );

  if (meta.mimeType === 'application/vnd.google-apps.folder') {
    onStage?.('กำลังค้นหาไฟล์ .dwg ล่าสุดในโฟลเดอร์...');
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const list = await apiJson(
      `${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&${key}`
    );
    const allFiles: DriveFileMeta[] = list.files || [];
    meta = pickLatestCadFile(allFiles, IS_MOBILE);

    const when = formatModifiedTh(meta.modifiedTime);
    onStage?.(
      `เลือกไฟล์ล่าสุด: ${meta.name}` +
        (when ? ` (อัปเดต ${when})` : '') +
        (meta.size ? ` · ${(Number(meta.size) / 1048576).toFixed(1)} MB` : '')
    );
  }

  if (IS_MOBILE && meta.size && Number(meta.size) > getMobileMaxUploadBytes()) {
    throw new Error(
      `ไฟล์ "${meta.name}" ใหญ่ ${(Number(meta.size) / 1048576).toFixed(0)} MB เกินกว่ามือถือ/iPad จะเปิดไหว (จำกัด ${(getMobileMaxUploadBytes() / 1048576).toFixed(0)} MB) ` +
        'กรุณาเปิดจากคอมพิวเตอร์ หรือให้ผู้ดูแลเพิ่มไฟล์ฉบับย่อสำหรับมือถือ (ตั้งชื่อลงท้ายด้วย _mobile.dxf) ในโฟลเดอร์ Drive'
    );
  }

  const mb = meta.size ? ` (${(Number(meta.size) / 1048576).toFixed(1)} MB)` : '';
  const when = formatModifiedTh(meta.modifiedTime);
  onStage?.(`กำลังดาวน์โหลด ${meta.name}${mb}${when ? ` · อัปเดต ${when}` : ''}...`);
  const res = await fetch(`${API}/${meta.id}?alt=media&supportsAllDrives=true&${key}`);
  if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
  return {
    buffer: await res.arrayBuffer(),
    filename: meta.name,
    modifiedTime: meta.modifiedTime,
  };
}
