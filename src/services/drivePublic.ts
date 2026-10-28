/**
 * ดึงไฟล์/โฟลเดอร์ Google Drive ที่แชร์เป็น "ทุกคนที่มีลิงก์" โดยไม่ต้องล็อกอิน
 *
 * โครงสร้างที่รองรับ (เช่น 03 แผนผังสั่งการ 2569):
 *   โฟลเดอร์หลัก
 *     ├─ ตุลาคม 2569/          ← เลือกเดือนล่าสุดก่อน
 *     │    └─ แผนผัง....dwg   ← แล้วเลือกไฟล์ .dwg ที่อัปเดตล่าสุด
 *     ├─ กันยายน 2569/
 *     └─ (ไฟล์ .dwg ที่ราก — ใช้เมื่อไม่มีโฟลเดอร์เดือน หรือใหม่กว่า)
 */
import { isMobileDevice, getMobileMaxUploadBytes } from '../utils/device';

const API = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_API_KEY: string = (import.meta.env.VITE_GOOGLE_API_KEY as string) || '';

export const IS_MOBILE: boolean =
  typeof window !== 'undefined' && isMobileDevice();

const MOBILE_NAME = /mobile|mob\b|phone|เล็ก|มือถือ|_mobile/i;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** ชื่อเดือนไทย → หมายเลข 1-12 */
const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

type DriveFileMeta = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string | number;
  modifiedTime?: string;
};

function sortByModifiedDesc(files: DriveFileMeta[]): DriveFileMeta[] {
  return files.slice().sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    if (tb !== ta) return tb - ta;
    return String(b.name || '').localeCompare(String(a.name || ''), 'th');
  });
}

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

/**
 * แปลงชื่อโฟลเดอร์เดือนไทย + ปี พ.ศ. → คะแนนเรียง (ยิ่งใหม่ยิ่งมาก)
 * รองรับ: "ตุลาคม 2569", "ต.ค. 2569", "2026-10", "2569-10"
 */
export function monthFolderSortKey(name: string): number {
  const n = (name || '').trim();

  // "ตุลาคม 2569" / "ตุลาคม2569"
  for (const [th, mon] of Object.entries(THAI_MONTHS)) {
    if (n.includes(th)) {
      const yearMatch = n.match(/(\d{4})/);
      const yearBe = yearMatch ? parseInt(yearMatch[1], 10) : 0;
      // พ.ศ. → ใช้ตรงๆ เป็นปีสำหรับเรียง (2569 > 2568)
      return yearBe * 100 + mon;
    }
  }

  // ต.ค. ก.ย. ฯลฯ
  const abbr: [RegExp, number][] = [
    [/ม\.ค\./, 1],
    [/ก\.พ\./, 2],
    [/มี\.ค\./, 3],
    [/เม\.ย\./, 4],
    [/พ\.ค\./, 5],
    [/มิ\.ย\./, 6],
    [/ก\.ค\./, 7],
    [/ส\.ค\./, 8],
    [/ก\.ย\./, 9],
    [/ต\.ค\./, 10],
    [/พ\.ย\./, 11],
    [/ธ\.ค\./, 12],
  ];
  for (const [re, mon] of abbr) {
    if (re.test(n)) {
      const yearMatch = n.match(/(\d{4})/);
      const yearBe = yearMatch ? parseInt(yearMatch[1], 10) : 0;
      return yearBe * 100 + mon;
    }
  }

  // 2569-10 หรือ 2026-10
  const iso = n.match(/(20\d{2}|25\d{2})[-_/](\d{1,2})/);
  if (iso) {
    return parseInt(iso[1], 10) * 100 + parseInt(iso[2], 10);
  }

  // ไม่ใช่ชื่อเดือน — ใช้ 0 (ไปท้าย) แต่ยังเทียบ modifiedTime ได้ภายนอก
  return 0;
}

function sortMonthFoldersDesc(folders: DriveFileMeta[]): DriveFileMeta[] {
  return folders.slice().sort((a, b) => {
    const ka = monthFolderSortKey(a.name);
    const kb = monthFolderSortKey(b.name);
    if (kb !== ka) return kb - ka;
    // ชื่อเดือน parse ไม่ได้: ใช้ modifiedTime ของโฟลเดอร์
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return tb - ta;
  });
}

export function pickLatestCadFile(allFiles: DriveFileMeta[], mobile = IS_MOBILE): DriveFileMeta {
  const dwgs = sortByModifiedDesc(allFiles.filter((f) => /\.dwg$/i.test(f.name || '')));
  const dxfs = sortByModifiedDesc(allFiles.filter((f) => /\.dxf$/i.test(f.name || '')));

  if (mobile) {
    const mobileNamed = sortByModifiedDesc(
      [...dwgs, ...dxfs].filter((f) => MOBILE_NAME.test(f.name || ''))
    );
    if (mobileNamed.length) return mobileNamed[0];
    const all = [...dwgs, ...dxfs].sort((a, b) => Number(a.size || 0) - Number(b.size || 0));
    if (!all.length) throw new Error('ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้');
    return all[0];
  }

  const desktopDwgs = dwgs.filter((f) => !MOBILE_NAME.test(f.name || ''));
  if (desktopDwgs.length) return desktopDwgs[0];
  if (dwgs.length) return dwgs[0];

  const desktopDxfs = dxfs.filter((f) => !MOBILE_NAME.test(f.name || ''));
  if (desktopDxfs.length) return desktopDxfs[0];
  if (dxfs.length) return dxfs[0];

  throw new Error('ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้');
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

async function listChildren(folderId: string, key: string): Promise<DriveFileMeta[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const list = await apiJson(
    `${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&${key}`
  );
  return list.files || [];
}

/**
 * จากรายการในโฟลเดอร์หลัก:
 * 1) หาโฟลเดอร์เดือน (ชื่อมีเดือนไทย+ปี) เรียงเดือนล่าสุดก่อน
 * 2) เข้าโฟลเดอร์เดือนล่าสุด เลือกไฟล์ CAD ล่าสุด
 * 3) ถ้าไม่มีไฟล์ในเดือนล่าสุด ลองเดือนถัดไป
 * 4) ถ้าไม่มีโฟลเดอร์เดือนเลย หรือไฟล์ที่รากใหม่กว่า — ใช้ไฟล์ที่ราก
 */
export async function resolveCadFromFolderListing(
  parentId: string,
  children: DriveFileMeta[],
  key: string,
  onStage?: (s: string) => void,
  mobile = IS_MOBILE
): Promise<DriveFileMeta> {
  const subfolders = children.filter((f) => f.mimeType === FOLDER_MIME);
  const rootFiles = children.filter((f) => f.mimeType !== FOLDER_MIME);

  // โฟลเดอร์ที่ชื่อเป็นเดือน (sort key > 0) หรือโฟลเดอร์ทั้งหมดถ้า parse ไม่ได้
  const monthFolders = sortMonthFoldersDesc(
    subfolders.filter((f) => monthFolderSortKey(f.name) > 0)
  );
  const foldersToTry =
    monthFolders.length > 0 ? monthFolders : sortMonthFoldersDesc(subfolders);

  let bestFromMonths: DriveFileMeta | null = null;
  let chosenMonthName = '';

  for (const folder of foldersToTry) {
    onStage?.(`กำลังเปิดโฟลเดอร์เดือน: ${folder.name}...`);
    try {
      const inner = await listChildren(folder.id, key);
      const cadInner = inner.filter(
        (f) => /\.(dwg|dxf)$/i.test(f.name || '') && f.mimeType !== FOLDER_MIME
      );
      if (!cadInner.length) continue;
      const picked = pickLatestCadFile(cadInner, mobile);
      bestFromMonths = picked;
      chosenMonthName = folder.name;
      break; // เดือนล่าสุดที่มีไฟล์ CAD แล้ว
    } catch (e) {
      console.warn('[drive] list month folder failed', folder.name, e);
    }
  }

  // ไฟล์ .dwg/.dxf ที่รากโฟลเดอร์หลัก
  let bestFromRoot: DriveFileMeta | null = null;
  try {
    const rootCad = rootFiles.filter((f) => /\.(dwg|dxf)$/i.test(f.name || ''));
    if (rootCad.length) bestFromRoot = pickLatestCadFile(rootCad, mobile);
  } catch {
    /* empty */
  }

  if (bestFromMonths && bestFromRoot) {
    // คอม: ถ้าไฟล์รากใหม่กว่าไฟล์ในเดือน (modifiedTime) ให้ใช้ราก — เผื่อวางไฟล์ล่าสุดที่ราก
    if (!mobile) {
      const tm = bestFromMonths.modifiedTime ? Date.parse(bestFromMonths.modifiedTime) : 0;
      const tr = bestFromRoot.modifiedTime ? Date.parse(bestFromRoot.modifiedTime) : 0;
      if (tr > tm) {
        onStage?.(`ใช้ไฟล์ที่รากโฟลเดอร์ (ใหม่กว่าเดือน ${chosenMonthName})`);
        return bestFromRoot;
      }
    }
    onStage?.(`เลือกจากเดือน ${chosenMonthName}`);
    return bestFromMonths;
  }

  if (bestFromMonths) {
    onStage?.(`เลือกจากเดือน ${chosenMonthName}`);
    return bestFromMonths;
  }
  if (bestFromRoot) return bestFromRoot;

  throw new Error(
    'ไม่พบไฟล์ .dwg หรือ .dxf ในโฟลเดอร์นี้หรือในโฟลเดอร์ย่อยรายเดือน'
  );
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

  if (meta.mimeType === FOLDER_MIME) {
    onStage?.(`กำลังค้นหาในโฟลเดอร์: ${meta.name}...`);
    const children = await listChildren(id, key);
    meta = await resolveCadFromFolderListing(id, children, key, onStage, IS_MOBILE);

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
