/** ตรวจจับอุปกรณ์มือถือ / iPad เพื่อจำกัดแรมและการโหลดอัตโนมัติ */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const uaMobile = /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // iPadOS 13+ รายงานตัวเองเป็น Macintosh แต่มี touch
  const iPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1) ||
    (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const touchPrimary = coarse || (navigator.maxTouchPoints || 0) > 1;

  return uaMobile || iPad || (touchPrimary && window.innerWidth > 0 && window.innerWidth < 1200);
}

/** จำกัด devicePixelRatio บนมือถือเพื่อลดแรมของ canvas */
export function getSafeDevicePixelRatio(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (isMobileDevice()) return Math.min(raw, 1);
  return Math.min(raw, 2);
}

/** เกณฑ์ไม่เก็บ DXF ดิบเป็น string (มือถือเข้มกว่า) */
export function getRawDxfKeepLimitBytes(): number {
  return isMobileDevice() ? 1 * 1024 * 1024 : 15 * 1024 * 1024;
}

/**
 * จำนวนเอนทิตีสูงสุดที่เรนเดอร์บนมือถือ/iPad
 * ตั้งสูงมาก = แทบไม่จำกัด (ให้ iPad ลองเปิดเต็มไฟล์)
 * ถ้าเครื่องแรมน้อยแล้วยังค้าง ค่อยลดกลับทีหลังได้
 */
export function getMobileEntityCap(): number {
  return Number.MAX_SAFE_INTEGER;
}

/**
 * ขนาดไฟล์สูงสุดที่ยอมให้เปิดจากเครื่องบนมือถือ
 * หลังดาวน์โหลดลงเครื่องแล้ว อนุญาตไฟล์ใหญ่ขึ้น
 */
export function getMobileMaxUploadBytes(): number {
  return 80 * 1024 * 1024;
}

/** ขนาดที่เริ่มเตือนว่าอาจช้า/กินแรม (ยังเปิดได้) */
export function getMobileWarnUploadBytes(): number {
  return 20 * 1024 * 1024;
}
