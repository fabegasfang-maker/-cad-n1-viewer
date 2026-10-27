import { repairLibreDwgDxf } from './dxfRepair';

/** แปลง DWG -> DXF ในเบราว์เซอร์ (Web Worker + LibreDWG wasm) */
export function convertDwgInBrowser(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number; repaired: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${import.meta.env.BASE_URL}dwg-worker.js`);
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) {
        // LibreDWG เขียนตัวขึ้นบรรทัดใหม่ดิบลงในข้อความ ทำให้คู่ group code เลื่อนและเอนทิตีหาย -> ซ่อมก่อนส่งต่อ
        const { buffer: dxf, fixed } = repairLibreDwgDxf(e.data.dxf);
        resolve({ dxf, duration: e.data.duration, exitCode: e.data.exitCode, repaired: fixed });
      } else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'โหลดตัวแปลง DWG ไม่สำเร็จ'));
    };
    // copy เพื่อไม่ให้ buffer เดิมของผู้เรียกถูก detach
    const copy = buffer.slice(0);
    worker.postMessage({ buffer: copy }, [copy]);
  });
}
