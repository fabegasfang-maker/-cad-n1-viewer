/**
 * Restore App.tsx + CadCanvasRenderer.tsx with Phase A+ mobile hard limits
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

function must(hay, needle, label) {
  if (!hay.includes(needle)) throw new Error(`missing block: ${label}`);
}

async function main() {
  let app = await (await fetch(APP_URL)).text();
  if (!app.includes('export default function App')) throw new Error('bad App download');

  if (!app.includes("from './utils/device'")) {
    app = app.replace(
      "import { convertDwgInBrowser, detectDwgVersion } from './utils/dwgClient';",
      "import { convertDwgInBrowser, detectDwgVersion } from './utils/dwgClient';\nimport { isMobileDevice, getRawDxfKeepLimitBytes, getMobileEntityCap, getMobileMaxUploadBytes } from './utils/device';"
    );
  } else if (!app.includes('getMobileEntityCap')) {
    app = app.replace(
      "import { isMobileDevice, getRawDxfKeepLimitBytes } from './utils/device';",
      "import { isMobileDevice, getRawDxfKeepLimitBytes, getMobileEntityCap, getMobileMaxUploadBytes } from './utils/device';"
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
  const keepNew = `          // มือถือ: ตัดเอนทิตีเกินเพดาน เพื่อกันค้างตอนเรนเดอร์
          let modelToUse = parsed;
          if (isMobileDevice() && parsed.entities.length > getMobileEntityCap()) {
            const cap = getMobileEntityCap();
            modelToUse = { ...parsed, entities: parsed.entities.slice(0, cap) };
            setConversionNote(
              \`โหมดมือถือ: แสดง \${cap.toLocaleString()} จาก \${parsed.entities.length.toLocaleString()} ออบเจ็กต์ (ไฟล์ใหญ่เกินไปสำหรับมือถือ)\`
            );
          }
          setModel(modelToUse);
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
  must(app, keepOld, 'keep');
  app = app.replace(keepOld, keepNew);

  const dxfOld = `          const parsed = parseDxfFromBuffer(buffer, undefined, fileName);
          setModel(parsed);
          setConversionError(null);
          setConversionNote(null);
          convertedDxfBufferRef.current = null;
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
  const dxfNew = `          const parsed = parseDxfFromBuffer(buffer, undefined, fileName);
          let modelToUse = parsed;
          if (isMobileDevice() && parsed.entities.length > getMobileEntityCap()) {
            const cap = getMobileEntityCap();
            modelToUse = { ...parsed, entities: parsed.entities.slice(0, cap) };
            setConversionNote(
              \`โหมดมือถือ: แสดง \${cap.toLocaleString()} จาก \${parsed.entities.length.toLocaleString()} ออบเจ็กต์\`
            );
          }
          setModel(modelToUse);
          setConversionError(null);
          if (!(isMobileDevice() && parsed.entities.length > getMobileEntityCap())) {
            setConversionNote(null);
          }
          convertedDxfBufferRef.current = null;
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
  must(app, dxfOld, 'dxf');
  app = app.replace(dxfOld, dxfNew);

  const uploadOld = `    if (!isDwg && !isDxf) {
      setConversionError('กรุณาเลือกไฟล์นามสกุล .DXF หรือ .DWG');
      return;
    }

    const buffer = await file.arrayBuffer();
    await processCadBuffer(buffer, fileName, isDwg);`;
  const uploadNew = `    if (!isDwg && !isDxf) {
      setConversionError('กรุณาเลือกไฟล์นามสกุล .DXF หรือ .DWG');
      return;
    }

    if (isMobileDevice() && file.size > getMobileMaxUploadBytes()) {
      setConversionError(
        \`ไฟล์ใหญ่ \${(file.size / 1048576).toFixed(1)} MB เกินกว่ามือถือ/iPad จะเปิดไหว \` +
          \`(จำกัด \${(getMobileMaxUploadBytes() / 1048576).toFixed(0)} MB) กรุณาเปิดจากคอมพิวเตอร์ หรือใช้ไฟล์ฉบับย่อ\`
      );
      return;
    }

    const buffer = await file.arrayBuffer();
    await processCadBuffer(buffer, fileName, isDwg);`;
  must(app, uploadOld, 'upload');
  app = app.replace(uploadOld, uploadNew);

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
  must(app, autoOld, 'auto');
  app = app.replace(autoOld, autoNew);

  // Folder: 03 แผนผังสั่งการ 2569 (เดือนย่อย → ไฟล์ล่าสุด)
  const NEW_DRIVE = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
  const OLD_DRIVE = '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY';
  if (app.includes(OLD_DRIVE)) {
    app = app.split(OLD_DRIVE).join(NEW_DRIVE);
    console.log('Updated DEFAULT_DRIVE_FILE_ID →', NEW_DRIVE);
  } else if (!app.includes(NEW_DRIVE)) {
    app = app.replace(
      /const DEFAULT_DRIVE_FILE_ID = '[^']+';/,
      "const DEFAULT_DRIVE_FILE_ID = '" + NEW_DRIVE + "';"
    );
    console.log('Replaced DEFAULT_DRIVE_FILE_ID via regex →', NEW_DRIVE);
  }

  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
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
  must(canvas, dprOld, 'dpr');
  canvas = canvas.replace(dprOld, dprNew);

  if (!canvas.includes('mobileStride')) {
    canvas = canvas.replace(
      '    // Viewport Culling: Compute visible CAD bounds with safety margin to skip offscreen entities',
      `    // มือถือ: ถ้าเอนทิตีเยอะมาก ให้ข้ามบางส่วนตอนซูมออก (กันค้าง)
    const mobileStride =
      typeof window !== 'undefined' &&
      model.entities.length > 15000 &&
      (window.innerWidth < 1200 || (navigator.maxTouchPoints || 0) > 1)
        ? Math.max(1, Math.floor(model.entities.length / 12000))
        : 1;

    // Viewport Culling: Compute visible CAD bounds with safety margin to skip offscreen entities`
    );
    canvas = canvas.replace(
      `    for (const ent of model.entities) {
      const layer = model.layers[ent.layer];
      if (layer && !layer.visible) continue;`,
      `    let _drawIdx = 0;
    for (const ent of model.entities) {
      _drawIdx++;
      if (mobileStride > 1 && _drawIdx % mobileStride !== 0 && ent.type === 'LINE') continue;
      const layer = model.layers[ent.layer];
      if (layer && !layer.visible) continue;`
    );
  }

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
