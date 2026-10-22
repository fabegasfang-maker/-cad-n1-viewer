// Web Worker: แปลง DWG -> DXF ในเบราว์เซอร์ด้วย LibreDWG (WebAssembly)
// ไม่ต้องใช้เซิร์ฟเวอร์ จึงใช้งานบน GitHub Pages ได้
importScripts('wasm/libredwg.js');

self.onmessage = async (e) => {
  const { buffer } = e.data;
  const start = Date.now();
  try {
    const wasm = await LibreDWG({
      locateFile: (p) => 'wasm/' + p,
    });
    // ต้องใช้ชื่อไฟล์เสมือนสั้นๆ เท่านั้น (กัน memory access out of bounds)
    wasm.FS.writeFile('in.dwg', new Uint8Array(buffer));
    let exitCode = -1;
    try {
      const fn = wasm.cwrap('convert_dwg_to_dxf', 'number', ['string', 'string']);
      exitCode = fn('in.dwg', 'out.dxf');
    } catch (err) {
      console.error('LibreDWG error:', err);
    }
    let out = null;
    try { out = wasm.FS.readFile('out.dxf'); } catch (_) {}
    if (out && out.length > 50) {
      const copy = out.slice().buffer;
      self.postMessage({ ok: true, dxf: copy, exitCode, duration: Date.now() - start }, [copy]);
    } else {
      self.postMessage({
        ok: false,
        error: `LibreDWG ไม่สามารถแปลงไฟล์ DWG นี้ได้ (รหัส: ${exitCode}) อาจเป็นเวอร์ชันใหม่ล่าสุดหรือมีฟีเจอร์เฉพาะของ Autodesk. แนะนำให้เปิดใน AutoCAD แล้ว Save As เป็น DXF 2018 หรือ 2007`,
      });
    }
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) || 'เกิดข้อผิดพลาดในการประมวลผลไฟล์ DWG' });
  }
};
