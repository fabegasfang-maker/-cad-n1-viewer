import { repairLibreDwgDxf } from './dxfRepair';

const DWG_VERSIONS: Record<string, string> = {
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
};

/** อ่านเวอร์ชันของไฟล์ DWG จาก 6 ไบต์แรก (เช่น AC1032) */
export function detectDwgVersion(buffer: ArrayBuffer): { code: string; label: string; isNew: boolean } {
  const code = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)));
  const label = DWG_VERSIONS[code] ?? code;
  // LibreDWG ที่ฝังในเว็บอ่านเอนทิตีของรูปแบบใหม่กว่า 2007 (AC1024 ขึ้นไป) ไม่ออก
  const isNew = /^AC10(2[4-9]|[3-9]\d)$/.test(code);
  return { code, label, isNew };
}

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
