import { convertDwgToDxf, init, CDN_WASM_BASE } from 'dwgdxf';

const DWG_VERSIONS: Record<string, string> = {
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
};

let initPromise: Promise<void> | null = null;

/** Pre-load WASM so the first conversion is faster */
export function warmUpDwgConverter(): Promise<void> {
  if (!initPromise) {
    // ใช้ CDN เพื่อให้ GitHub Pages โหลด WASM ได้โดยไม่ต้อง bundle ไฟล์ใหญ่
    initPromise = init({ wasmBase: CDN_WASM_BASE }).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** อ่านเวอร์ชันของไฟล์ DWG จาก 6 ไบต์แรก (เช่น AC1032) */
export function detectDwgVersion(buffer: ArrayBuffer): { code: string; label: string; isNew: boolean } {
  const code = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)));
  const label = DWG_VERSIONS[code] ?? code;
  // acadrust/dwgdxf รองรับถึง AC1032 (2018) ได้ดีกว่า LibreDWG เดิม
  const isNew = /^AC10(3[3-9]|[4-9]\d)$/.test(code);
  return { code, label, isNew };
}

/**
 * แปลง DWG -> DXF ในเบราว์เซอร์ด้วย dwgdxf (acadrust WASM)
 * ไม่ต้องใช้ Web Worker แยกแล้ว เพราะ runtime ถูก reuse ระหว่างการแปลง
 */
export async function convertDwgInBrowser(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number; repaired: number }> {
  const start = Date.now();
  try {
    await warmUpDwgConverter();
    const dxfBytes = await convertDwgToDxf(buffer, { wasmBase: CDN_WASM_BASE });

    if (!dxfBytes || dxfBytes.byteLength < 50) {
      throw new Error(
        'dwgdxf ไม่สามารถแปลงไฟล์ DWG นี้ได้ (ผลลัพธ์ว่างเปล่า) อาจเป็นเวอร์ชันใหม่เกินไปหรือมีฟีเจอร์เฉพาะของ Autodesk'
      );
    }

    // คัดลอกเป็น ArrayBuffer ใหม่เพื่อความปลอดภัย
    const copy = dxfBytes.buffer.slice(
      dxfBytes.byteOffset,
      dxfBytes.byteOffset + dxfBytes.byteLength
    ) as ArrayBuffer;

    return {
      dxf: copy,
      duration: Date.now() - start,
      exitCode: 0,
      repaired: 0, // dwgdxf ไม่ต้องซ่อม LF ดิบเหมือน LibreDWG
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    throw new Error(
      `แปลง DWG ด้วย dwgdxf ไม่สำเร็จ: ${msg}. แนะนำให้เปิดใน AutoCAD แล้ว Save As เป็น DXF 2018 หรือ 2007`
    );
  }
}
