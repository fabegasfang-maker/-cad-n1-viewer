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
  // อย่าใช้แค่ความกว้างจอ — iPad Pro กว้างเกิน 900 ได้
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

/** จำนวนเอนทิตีสูงสุดที่เรนเดอร์บนมือถือ */
export function getMobileEntityCap(): number {
  return 25000;
}

/** ขนาดไฟล์สูงสุดที่ยอมให้อัปโหลด/โหลดบนมือถือ */
export function getMobileMaxUploadBytes(): number {
  return 12 * 1024 * 1024;
}
