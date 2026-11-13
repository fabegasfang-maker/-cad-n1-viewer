/**
 * แปลง DWG -> DXF ใน Node ด้วย LibreDWG (WebAssembly) ตัวเดียวกับที่ตัวดูบนเว็บใช้
 * ใช้: node dwg-to-dxf.mjs in.dwg out.dxf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/wasm');

async function loadLibreDwg() {
  // libredwg.js เป็นสคริปต์ UMD/emscripten: โหลดผ่าน Function เพื่อไม่ให้ชนกับ "type": "module"
  const src = fs.readFileSync(path.join(WASM_DIR, 'libredwg.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', '__filename', '__dirname', 'require', src)(
    mod,
    mod.exports,
    path.join(WASM_DIR, 'libredwg.js'),
    WASM_DIR,
    (await import('node:module')).createRequire(import.meta.url)
  );
  return mod.exports;
}

export async function dwgToDxf(inPath, outPath) {
  const LibreDWG = await loadLibreDwg();
  const wasm = await LibreDWG({ locateFile: (p) => path.join(WASM_DIR, p) });
  // ใช้ชื่อไฟล์เสมือนสั้นๆ เหมือนใน public/dwg-worker.js (กัน memory access out of bounds)
  wasm.FS.writeFile('in.dwg', new Uint8Array(fs.readFileSync(inPath)));
  const convert = wasm.cwrap('convert_dwg_to_dxf', 'number', ['string', 'string']);
  const code = convert('in.dwg', 'out.dxf');
  let out = null;
  try {
    out = wasm.FS.readFile('out.dxf');
  } catch {}
  if (!out || out.length < 50) {
    throw new Error(`LibreDWG แปลงไฟล์ DWG นี้ไม่ได้ (รหัส ${code}) อาจเป็นเวอร์ชันใหม่เกินไป`);
  }
  fs.writeFileSync(outPath, out);
  return { exitCode: code, bytes: out.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('ใช้: node dwg-to-dxf.mjs in.dwg out.dxf');
    process.exit(2);
  }
  dwgToDxf(input, output)
    .then((r) => console.log(`DXF ok (${(r.bytes / 1048576).toFixed(1)} MB, code ${r.exitCode})`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
