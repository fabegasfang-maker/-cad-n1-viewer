/// <reference lib="webworker" />
import { convertDwgToDxf, init, CDN_WASM_BASE } from 'dwgdxf';

let ready: Promise<void> | null = null;

function ensureReady() {
  if (!ready) {
    ready = init({ wasmBase: CDN_WASM_BASE }).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer }>) => {
  const start = Date.now();
  try {
    const { buffer } = e.data;
    await ensureReady();
    const dxfBytes = await convertDwgToDxf(buffer, { wasmBase: CDN_WASM_BASE });
    if (!dxfBytes || dxfBytes.byteLength < 50) {
      (self as DedicatedWorkerGlobalScope).postMessage({
        ok: false,
        error:
          'dwgdxf ไม่สามารถแปลงไฟล์ DWG นี้ได้ (ผลลัพธ์ว่างเปล่า) อาจเป็นเวอร์ชันใหม่เกินไปหรือมีฟีเจอร์เฉพาะของ Autodesk',
      });
      return;
    }
    const copy = dxfBytes.buffer.slice(
      dxfBytes.byteOffset,
      dxfBytes.byteOffset + dxfBytes.byteLength
    );
    (self as DedicatedWorkerGlobalScope).postMessage(
      { ok: true, dxf: copy, duration: Date.now() - start, exitCode: 0 },
      [copy]
    );
  } catch (err: any) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      ok: false,
      error: err?.message || String(err) || 'เกิดข้อผิดพลาดในการแปลง DWG',
    });
  }
};
