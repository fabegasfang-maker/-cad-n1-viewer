/** ตรวจจับอุปกรณ์มือถือ / iPad เพื่อจำกัดแรมและการโหลดอัตโนมัติ */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const uaMobile = /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // iPadOS 13+ รายงานตัวเองเป็น Macintosh แต่มี touch
  const iPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth > 0 && window.innerWidth < 900;

  return uaMobile || iPad || (coarse && narrow);
}

/** จำกัด devicePixelRatio บนมือถือเพื่อลดแรมของ canvas */
export function getSafeDevicePixelRatio(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (isMobileDevice()) return Math.min(raw, 1.25);
  return Math.min(raw, 2);
}

/** เกณฑ์ไม่เก็บ DXF ดิบเป็น string (มือถือเข้มกว่า) */
export function getRawDxfKeepLimitBytes(): number {
  return isMobileDevice() ? 2 * 1024 * 1024 : 15 * 1024 * 1024;
}
