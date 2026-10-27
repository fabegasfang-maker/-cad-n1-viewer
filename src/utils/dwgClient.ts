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

/** Pre-load WASM so the first conversion is faster (main-thread fallback) */
export function warmUpDwgConverter(): Promise<void> {
  if (!initPromise) {
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
  const isNew = /^AC10(3[3-9]|[4-9]\d)$/.test(code);
  return { code, label, isNew };
}

function convertOnMainThread(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number; repaired: number }> {
  return (async () => {
    const start = Date.now();
    await warmUpDwgConverter();
    const dxfBytes = await convertDwgToDxf(buffer, { wasmBase: CDN_WASM_BASE });
    if (!dxfBytes || dxfBytes.byteLength < 50) {
      throw new Error(
        'dwgdxf ไม่สามารถแปลงไฟล์ DWG นี้ได้ (ผลลัพธ์ว่างเปล่า) อาจเป็นเวอร์ชันใหม่เกินไปหรือมีฟีเจอร์เฉพาะของ Autodesk'
      );
    }
    const copy = dxfBytes.buffer.slice(
      dxfBytes.byteOffset,
      dxfBytes.byteOffset + dxfBytes.byteLength
    ) as ArrayBuffer;
    return { dxf: copy, duration: Date.now() - start, exitCode: 0, repaired: 0 };
  })();
}

function convertInWorker(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number; repaired: number }> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./dwg.worker.ts', import.meta.url), { type: 'module' });
    } catch (err: any) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('แปลง DWG ใช้เวลานานเกินไป (timeout) ไฟล์อาจใหญ่เกินสำหรับเครื่องนี้'));
    }, 180_000);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data?.ok) {
        resolve({
          dxf: e.data.dxf,
          duration: e.data.duration ?? 0,
          exitCode: e.data.exitCode ?? 0,
          repaired: 0,
        });
      } else {
        reject(new Error(e.data?.error || 'แปลง DWG ใน Worker ไม่สำเร็จ'));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e.message || 'โหลด Worker แปลง DWG ไม่สำเร็จ'));
    };

    const copy = buffer.slice(0);
    worker.postMessage({ buffer: copy }, [copy]);
  });
}

/**
 * แปลง DWG -> DXF
 * ใช้ module Worker ก่อน (ไม่บล็อก UI) ถ้าสร้าง Worker ไม่ได้จึง fallback บน main thread
 */
export async function convertDwgInBrowser(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number; repaired: number }> {
  try {
    return await convertInWorker(buffer);
  } catch (workerErr: any) {
    console.warn('[dwgClient] Worker conversion failed, falling back to main thread:', workerErr);
    try {
      return await convertOnMainThread(buffer);
    } catch (err: any) {
      const msg = err?.message || String(err);
      throw new Error(
        `แปลง DWG ด้วย dwgdxf ไม่สำเร็จ: ${msg}. แนะนำให้เปิดใน AutoCAD แล้ว Save As เป็น DXF 2018 หรือ 2007`
      );
    }
  }
}
