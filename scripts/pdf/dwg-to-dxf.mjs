/**
 * แปลง DWG -> DXF ใน Node ด้วย dwgdxf (acadrust WebAssembly) เป็นตัวหลัก
 * เพื่อให้ได้เอนทิตี เส้น และบล็อกครบถ้วนเหมือนโหมด PC พร้อมถอยกลับไปใช้ LibreDWG อัตโนมัติหากจำเป็น
 * ใช้: node dwg-to-dxf.mjs in.dwg out.dxf
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/wasm');

async function convertWithDwgDxf(dwgBuffer) {
  const mod = await import('dwgdxf');
  const api = mod.default && typeof mod.init !== 'function' ? mod.default : mod;
  if (typeof api.init === 'function') {
    await api.init();
  }
  const fn = api.convertDwgToDxf || api.dwgToDxf || api.convert;
  if (typeof fn !== 'function') {
    throw new Error('ไม่พบฟังก์ชัน convertDwgToDxf ในแพ็กเกจ dwgdxf');
  }
  const res = await fn(new Uint8Array(dwgBuffer));
  let outBytes = null;
  if (typeof res === 'string') {
    outBytes = Buffer.from(res, 'utf8');
  } else if (res instanceof Uint8Array || Buffer.isBuffer(res)) {
    outBytes = res;
  } else if (res instanceof ArrayBuffer) {
    outBytes = new Uint8Array(res);
  } else if (res && res.dxf) {
    outBytes = typeof res.dxf === 'string' ? Buffer.from(res.dxf, 'utf8') : new Uint8Array(res.dxf);
  }
  if (!outBytes || outBytes.length < 50) {
    throw new Error('dwgdxf คืนค่าข้อมูล DXF ว่างหรือไม่สมบูรณ์');
  }
  return outBytes;
}

async function loadLibreDwg() {
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

async function convertWithLibreDwg(dwgBuffer) {
  const LibreDWG = await loadLibreDwg();
  const wasm = await LibreDWG({ locateFile: (p) => path.join(WASM_DIR, p) });
  wasm.FS.writeFile('in.dwg', new Uint8Array(dwgBuffer));
  const convert = wasm.cwrap('convert_dwg_to_dxf', 'number', ['string', 'string']);
  const code = convert('in.dwg', 'out.dxf');
  let out = null;
  try {
    out = wasm.FS.readFile('out.dxf');
  } catch {}
  if (!out || out.length < 50) {
    throw new Error(`LibreDWG แปลงไฟล์ DWG นี้ไม่ได้ (รหัส ${code}) อาจเป็นเวอร์ชันใหม่เกินไป`);
  }
  return { out, exitCode: code };
}

export async function dwgToDxf(inPath, outPath) {
  const dwgBuffer = fs.readFileSync(inPath);
  try {
    const out = await convertWithDwgDxf(dwgBuffer);
    fs.writeFileSync(outPath, out);
    console.log(`แปลง DWG -> DXF ด้วย dwgdxf (acadrust) สำเร็จ (${(out.length / 1048576).toFixed(1)} MB)`);
    return { engine: 'dwgdxf', exitCode: 0, bytes: out.length };
  } catch (err) {
    console.warn(`dwgdxf แปลงไม่สำเร็จ (${err?.message || err}) -> ถอยกลับไปใช้ LibreDWG...`);
  }

  const { out, exitCode } = await convertWithLibreDwg(dwgBuffer);
  fs.writeFileSync(outPath, out);
  console.log(`แปลง DWG -> DXF ด้วย LibreDWG สำเร็จ (${(out.length / 1048576).toFixed(1)} MB, code=${exitCode})`);
  return { engine: 'libredwg', exitCode, bytes: out.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('ใช้: node dwg-to-dxf.mjs in.dwg out.dxf');
    process.exit(2);
  }
  dwgToDxf(input, output)
    .then((r) => console.log(`DXF ok [${r.engine}] (${(r.bytes / 1048576).toFixed(1)} MB, code ${r.exitCode})`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}