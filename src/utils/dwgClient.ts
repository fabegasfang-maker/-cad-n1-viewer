/** แปลง DWG -> DXF ในเบราว์เซอร์ (Web Worker + LibreDWG wasm) */
export function convertDwgInBrowser(
  buffer: ArrayBuffer
): Promise<{ dxf: ArrayBuffer; duration: number; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${import.meta.env.BASE_URL}dwg-worker.js`);
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve({ dxf: e.data.dxf, duration: e.data.duration, exitCode: e.data.exitCode });
      else reject(new Error(e.data.error));
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
