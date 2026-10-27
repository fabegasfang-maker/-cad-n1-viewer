/**
 * Restore App.tsx + CadCanvasRenderer.tsx with Phase A mobile fixes
 * Run from repo root: node scripts/restore-phase-a.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const APP_URL =
  'https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/6a28043f84a2a2f340266388164b29873f6e116c/src/App.tsx';
const CANVAS_URL =
  'https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/6a28043f84a2a2f340266388164b29873f6e116c/src/components/CadCanvasRenderer.tsx';

async function main() {
  let app = await (await fetch(APP_URL)).text();
  if (!app.includes('export default function App')) throw new Error('bad App download');

  if (!app.includes("from './utils/device'")) {
    app = app.replace(
      "import { convertDwgInBrowser, detectDwgVersion } from './utils/dwgClient';",
      "import { convertDwgInBrowser, detectDwgVersion } from './utils/dwgClient';\nimport { isMobileDevice, getRawDxfKeepLimitBytes } from './utils/device';"
    );
  }

  const keepOld = `          setModel(parsed);
          // ไฟล์ใหญ่ไม่เก็บ DXF ดิบเป็นสตริงซ้ำใน state (กินแรมเท่าตัว โดยเฉพาะบนมือถือ)
          if (bytes.byteLength < 15 * 1024 * 1024) {
            const decoder = new TextDecoder('utf-8');
            setRawDxfString(decoder.decode(bytes));
            convertedDxfBufferRef.current = null;
          } else {
            setRawDxfString('');
            convertedDxfBufferRef.current = bytes.buffer as ArrayBuffer;
          }`;
  const keepNew = `          setModel(parsed);
          // มือถือ/ไฟล์ใหญ่: ไม่เก็บ DXF ดิบใน memory (กัน iOS Safari OOM)
          const keepLimit = getRawDxfKeepLimitBytes();
          if (!isMobileDevice() && bytes.byteLength < keepLimit) {
            const decoder = new TextDecoder('utf-8');
            setRawDxfString(decoder.decode(bytes));
            convertedDxfBufferRef.current = bytes.byteLength < 8 * 1024 * 1024 ? (bytes.buffer as ArrayBuffer) : null;
          } else {
            setRawDxfString('');
            convertedDxfBufferRef.current = null;
          }`;
  if (!app.includes(keepOld)) throw new Error('keep block not found');
  app = app.replace(keepOld, keepNew);

  const dxfOld = `          convertedDxfBufferRef.current = null;
          // ป้องกันการ decode ข้อความขนาด 150MB เก็บใน state ซ้ำซ้อน ซึ่งทำให้เบราว์เซอร์กินแรมสูงและกระตุก
          if (buffer.byteLength < 15 * 1024 * 1024) {
            const textDecoder = new TextDecoder('windows-874');
            try {
              setRawDxfString(textDecoder.decode(buffer));
            } catch {
              setRawDxfString('');
            }
          } else {
            setRawDxfString('');
          }`;
  const dxfNew = `          convertedDxfBufferRef.current = null;
          // มือถือไม่ decode DXF ทั้งไฟล์เป็น string
          if (!isMobileDevice() && buffer.byteLength < getRawDxfKeepLimitBytes()) {
            const textDecoder = new TextDecoder('windows-874');
            try {
              setRawDxfString(textDecoder.decode(buffer));
            } catch {
              setRawDxfString('');
            }
          } else {
            setRawDxfString('');
          }`;
  if (!app.includes(dxfOld)) throw new Error('dxf block not found');
  app = app.replace(dxfOld, dxfNew);

  const autoOld = `  // Auto load default Google Drive file on app open (NO login required!)
  useEffect(() => {
    if ((!STATIC_HOSTING || DRIVE_API_KEY) && !model && !autoLoadAttempted && driveFileId) {
      setAutoLoadAttempted(true);
      loadPublicDriveFile(driveFileId).catch((err) => {
        console.warn('Auto load default Google Drive file failed:', err);
      });
    }
  }, [model, autoLoadAttempted, driveFileId, loadPublicDriveFile]);`;
  const autoNew = `  // Auto load default Google Drive file on app open (desktop only — มือถือ/iPad ข้ามเพื่อกัน OOM)
  useEffect(() => {
    if (isMobileDevice()) {
      if (!autoLoadAttempted) {
        setAutoLoadAttempted(true);
        setConversionNote('โหมดมือถือ/iPad: ไม่โหลดไฟล์ใหญ่ให้อัตโนมัติ กดปุ่ม Drive หรือเลือกไฟล์เอง');
      }
      return;
    }
    if ((!STATIC_HOSTING || DRIVE_API_KEY) && !model && !autoLoadAttempted && driveFileId) {
      setAutoLoadAttempted(true);
      loadPublicDriveFile(driveFileId).catch((err) => {
        console.warn('Auto load default Google Drive file failed:', err);
      });
    }
  }, [model, autoLoadAttempted, driveFileId, loadPublicDriveFile]);`;
  if (!app.includes(autoOld)) throw new Error('auto block not found');
  app = app.replace(autoOld, autoNew);

  fs.writeFileSync(path.join(root, 'src/App.tsx'), app);
  console.log('Restored src/App.tsx', app.length, 'bytes');

  let canvas = await (await fetch(CANVAS_URL)).text();
  if (!canvas.includes('getSafeDevicePixelRatio')) {
    canvas = canvas.replace(
      "import { getContrastedCadColor } from '../utils/cadColors';",
      "import { getContrastedCadColor } from '../utils/cadColors';\nimport { getSafeDevicePixelRatio } from '../utils/device';"
    );
  }
  const dprOld = `    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }`;
  const dprNew = `    // Handle high DPI — มือถือจำกัด DPR เพื่อลดแรม canvas
    const dpr = getSafeDevicePixelRatio();
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }`;
  if (!canvas.includes(dprOld)) throw new Error('dpr block not found');
  canvas = canvas.replace(dprOld, dprNew);
  if (!canvas.includes('touchAction')) {
    canvas = canvas.replace(
      'className="w-full h-full block"',
      "className=\"w-full h-full block\"\n        style={{ touchAction: 'none' }}"
    );
  }
  fs.writeFileSync(path.join(root, 'src/components/CadCanvasRenderer.tsx'), canvas);
  console.log('Restored CadCanvasRenderer.tsx', canvas.length, 'bytes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
