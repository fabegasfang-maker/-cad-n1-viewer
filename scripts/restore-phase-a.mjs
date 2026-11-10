/**
 * Restore App.tsx + CadCanvasRenderer.tsx (mobile + Drive + UI + download + localStorage migrate + export DWG)
 * Run: node scripts/restore-phase-a.mjs
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

const NEW_DRIVE = '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
const OLD_DRIVE = '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY';

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
          // ไฟล์ใหญ่ไม่เก็บ DXF ดิบเป็นสตริงซ้ำใน state (กินแรมเท่าตัว โดยเฉพาะบนมือถือ)\n          if (bytes.byteLength < 15 * 1024 * 1024) {\n            const decoder = new TextDecoder('utf-8');\n            setRawDxfString(decoder.decode(bytes));\n            convertedDxfBufferRef.current = null;\n          } else {\n            setRawDxfString('');\n            convertedDxfBufferRef.current = bytes.buffer as ArrayBuffer;\n          }`;
  const keepNew = `          // มือถือ: ตัดเอนทิตีเกินเพดาน เพื่อกันค้างตอนเรนเดอร์\n          let modelToUse = parsed;\n          if (isMobileDevice() && parsed.entities.length > getMobileEntityCap()) {\n            const cap = getMobileEntityCap();\n            modelToUse = { ...parsed, entities: parsed.entities.slice(0, cap) };\n            setConversionNote(\n              \`โหมดมือถือ: แสดง \${cap.toLocaleString()} จาก \${parsed.entities.length.toLocaleString()} ออบเจ็กต์ (ไฟล์ใหญ่เกินไปสำหรับมือถือ)\`\n            );\n          }\n          setModel(modelToUse);\n          const keepLimit = getRawDxfKeepLimitBytes();\n          if (!isMobileDevice() && bytes.byteLength < keepLimit) {\n            const decoder = new TextDecoder('utf-8');\n            setRawDxfString(decoder.decode(bytes));\n            convertedDxfBufferRef.current = bytes.byteLength < 8 * 1024 * 1024 ? (bytes.buffer as ArrayBuffer) : null;\n          } else {\n            setRawDxfString('');\n            convertedDxfBufferRef.current = null;\n          }`;
  must(app, keepOld, 'keep');
  app = app.replace(keepOld, keepNew);

  const dxfOld = `          const parsed = parseDxfFromBuffer(buffer, undefined, fileName);\n          setModel(parsed);\n          setConversionError(null);\n          setConversionNote(null);\n          convertedDxfBufferRef.current = null;\n          // ป้องกันการ decode ข้อความขนาด 150MB เก็บใน state ซ้ำซ้อน ซึ่งทำให้เบราว์เซอร์กินแรมสูงและกระตุก\n          if (buffer.byteLength < 15 * 1024 * 1024) {\n            const textDecoder = new TextDecoder('windows-874');\n            try {\n              setRawDxfString(textDecoder.decode(buffer));\n            } catch {\n              setRawDxfString('');\n            }\n          } else {\n            setRawDxfString('');\n          }`;
  const dxfNew = `          const parsed = parseDxfFromBuffer(buffer, undefined, fileName);\n          let modelToUse = parsed;\n          if (isMobileDevice() && parsed.entities.length > getMobileEntityCap()) {\n            const cap = getMobileEntityCap();\n            modelToUse = { ...parsed, entities: parsed.entities.slice(0, cap) };\n            setConversionNote(\n              \`โหมดมือถือ: แสดง \${cap.toLocaleString()} จาก \${parsed.entities.length.toLocaleString()} ออบเจ็กต์\`\n            );\n          }\n          setModel(modelToUse);\n          setConversionError(null);\n          if (!(isMobileDevice() && parsed.entities.length > getMobileEntityCap())) {\n            setConversionNote(null);\n          }\n          convertedDxfBufferRef.current = null;\n          if (!isMobileDevice() && buffer.byteLength < getRawDxfKeepLimitBytes()) {\n            const textDecoder = new TextDecoder('windows-874');\n            try {\n              setRawDxfString(textDecoder.decode(buffer));\n            } catch {\n              setRawDxfString('');\n            }\n          } else {\n            setRawDxfString('');\n          }`;
  must(app, dxfOld, 'dxf');
  app = app.replace(dxfOld, dxfNew);

  const uploadOld = `    if (!isDwg && !isDxf) {\n      setConversionError('กรุณาเลือกไฟล์นามสกุล .DXF หรือ .DWG');\n      return;\n    }\n\n    const buffer = await file.arrayBuffer();\n    await processCadBuffer(buffer, fileName, isDwg);`;
  const uploadNew = `    if (!isDwg && !isDxf) {\n      setConversionError('กรุณาเลือกไฟล์นามสกุล .DXF หรือ .DWG');\n      return;\n    }\n\n    if (isMobileDevice() && file.size > getMobileMaxUploadBytes()) {\n      setConversionError(\n        \`ไฟล์ใหญ่ \${(file.size / 1048576).toFixed(1)} MB เกินกว่ามือถือ/iPad จะเปิดไหว \` +\n          \`(จำกัด \${(getMobileMaxUploadBytes() / 1048576).toFixed(0)} MB) กรุณาเปิดจากคอมพิวเตอร์ หรือใช้ไฟล์ฉบับย่อ\`\n      );\n      return;\n    }\n\n    const buffer = await file.arrayBuffer();\n    await processCadBuffer(buffer, fileName, isDwg);`;
  must(app, uploadOld, 'upload');
  app = app.replace(uploadOld, uploadNew);

  const autoOld = `  // Auto load default Google Drive file on app open (NO login required!)\n  useEffect(() => {\n    if ((!STATIC_HOSTING || DRIVE_API_KEY) && !model && !autoLoadAttempted && driveFileId) {\n      setAutoLoadAttempted(true);\n      loadPublicDriveFile(driveFileId).catch((err) => {\n        console.warn('Auto load default Google Drive file failed:', err);\n      });\n    }\n  }, [model, autoLoadAttempted, driveFileId, loadPublicDriveFile]);`;
  const autoNew = `  // Auto load default Google Drive file on app open (desktop only — มือถือ/iPad ข้ามเพื่อกัน OOM)\n  useEffect(() => {\n    if (isMobileDevice()) {\n      if (!autoLoadAttempted) {\n        setAutoLoadAttempted(true);\n        setConversionNote('โหมดมือถือ/iPad: กด «ดาวน์โหลดไฟล์งาน» เพื่อบันทึก DWG ลงเครื่อง แล้วค่อยเปิดไฟล์ — หรือเลือกไฟล์จากเครื่อง');\n      }\n      return;\n    }\n    if ((!STATIC_HOSTING || DRIVE_API_KEY) && !model && !autoLoadAttempted && driveFileId) {\n      setAutoLoadAttempted(true);\n      loadPublicDriveFile(driveFileId).catch((err) => {\n        console.warn('Auto load default Google Drive file failed:', err);\n      });\n    }\n  }, [model, autoLoadAttempted, driveFileId, loadPublicDriveFile]);`;
  must(app, autoOld, 'auto');
  app = app.replace(autoOld, autoNew);

  if (app.includes(OLD_DRIVE)) {
    app = app.split(OLD_DRIVE).join(NEW_DRIVE);
    console.log('Updated DEFAULT_DRIVE_FILE_ID →', NEW_DRIVE);
  }

  const oldInit = `  const [driveFileId, setDriveFileId] = useState<string>(() => {\n    return localStorage.getItem('cad_default_drive_file_id') || DEFAULT_DRIVE_FILE_ID;\n  });`;
  const newInit = `  const [driveFileId, setDriveFileId] = useState<string>(() => {\n    try {\n      const stored = localStorage.getItem('cad_default_drive_file_id');\n      const legacyIds = new Set([\n        '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY',\n      ]);\n      if (!stored || legacyIds.has(stored)) {\n        localStorage.setItem('cad_default_drive_file_id', DEFAULT_DRIVE_FILE_ID);\n        return DEFAULT_DRIVE_FILE_ID;\n      }\n      return stored;\n    } catch {\n      return DEFAULT_DRIVE_FILE_ID;\n    }\n  });`;
  if (app.includes(oldInit)) {
    app = app.replace(oldInit, newInit);
    console.log('Patched driveFileId localStorage migration');
  }

  if (app.includes('เปิดทุกเลเยอร์')) {
    app = app.replace(
      /\s*\{\/\* Quick Show All Layers \*\/\}[\s\S]*?<span className="hidden xl:inline">เปิดทุกเลเยอร์<\/span>\s*<\/button>\n/,
      '\n'
    );
  }
  if (app.includes('แก้เส้นขาด')) {
    app = app.replace(
      /\s*\{\/\* Quick Force Solid Lines to fix missing lines \*\/\}[\s\S]*?\{forceSolidLines \? 'เส้นทึบ \(เปิด\)' : 'แก้เส้นขาด'\}[\s\S]*?<\/button>\n/,
      '\n'
    );
  }
  if (app.includes('Thai Font Selector')) {
    app = app.replace(
      /\s*\{\/\* Thai Font Selector \*\/\}[\s\S]*?(?=\s*\{\/\* Theme Selector \*\/\})/,
      '\n'
    );
  }
  if (app.includes('text-[11px] opacity-60 truncate max-w-[280px]')) {
    app = app.replace(
      `              <p className="text-[11px] opacity-60 truncate max-w-[280px]">\n                {model ? \`\${model.filename} (\${model.entities.length} วัตถุ)\` : 'พร้อมเปิดไฟล์แบบร่าง'}\n              </p>`,
      `              <p className="font-bold text-base tracking-tight truncate max-w-[min(52vw,560px)] opacity-95" title={model ? model.filename : undefined}>\n                {model ? model.filename : 'พร้อมเปิดไฟล์แบบร่าง'}\n              </p>`
    );
  }
  if (app.includes('mouseCadCoord.x.toFixed')) {
    app = app.replace(
      `          {/* พิกัด XY & Zoom (อยู่หลังปุ่มขนาดอักษรและความหนาเส้น) */}\n          <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 px-2.5 py-1 rounded-lg font-mono text-[11px] text-slate-300 whitespace-nowrap shrink-0">\n            <span>\n              X: <strong className="text-white font-bold">{mouseCadCoord.x.toFixed(3)}</strong>\n            </span>\n            <span className="text-slate-600">|</span>\n            <span>\n              Y: <strong className="text-white font-bold">{mouseCadCoord.y.toFixed(3)}</strong>\n            </span>\n            <span className="text-slate-600">|</span>\n            <span>\n              Zoom: <strong className="text-white font-bold">{Math.round(zoomLevel * 100)}%</strong>\n            </span>\n          </div>`,
      `          <div className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 px-2.5 py-1 rounded-lg font-mono text-[11px] text-slate-300 whitespace-nowrap shrink-0">\n            <span>\n              Zoom: <strong className="text-white font-bold">{Math.round(zoomLevel * 100)}%</strong>\n            </span>\n          </div>`
    );
  }

  if (!app.includes('downloadPublicDriveCadToDevice')) {
    app = app.replace(
      "import { fetchPublicDriveCad, DRIVE_API_KEY } from './services/drivePublic';",
      "import { fetchPublicDriveCad, downloadPublicDriveCadToDevice, DRIVE_API_KEY } from './services/drivePublic';"
    );
  }
  if (!app.includes('isDownloadingToDevice')) {
    app = app.replace(
      '  const [autoLoadAttempted, setAutoLoadAttempted] = useState<boolean>(false);',
      `  const [autoLoadAttempted, setAutoLoadAttempted] = useState<boolean>(false);\n  const [isMobileUi, setIsMobileUi] = useState(false);\n  const [isDownloadingToDevice, setIsDownloadingToDevice] = useState(false);\n\n  useEffect(() => {\n    setIsMobileUi(isMobileDevice());\n  }, []);`
    );
  }
  if (!app.includes('downloadLatestCadToDevice')) {
    const insertAfter = `  // Auto load default Google Drive file on app open (desktop only — มือถือ/iPad ข้ามเพื่อกัน OOM)`;
    const handler = `  const downloadLatestCadToDevice = useCallback(async () => {\n    if (!driveFileId) {\n      setConversionError('ยังไม่ได้ตั้งค่าโฟลเดอร์ Google Drive');\n      return;\n    }\n    setIsDownloadingToDevice(true);\n    setConversionError(null);\n    try {\n      const { filename, sizeBytes } = await downloadPublicDriveCadToDevice(\n        driveFileId,\n        setDriveLoadingStage\n      );\n      setConversionNote(\n        \`บันทึก \${filename} (\${(sizeBytes / 1048576).toFixed(1)} MB) ลงเครื่องแล้ว — เปิดด้วยแอป CAD หรือกด «เปิดไฟล์» เพื่อดูในเว็บ (ถ้าขนาดไม่เกินขีดจำกัด)\`\n      );\n    } catch (err) {\n      setConversionError((err && err.message) || 'ดาวน์โหลดไฟล์ลงเครื่องไม่สำเร็จ');\n    } finally {\n      setIsDownloadingToDevice(false);\n      setDriveLoadingStage('');\n    }\n  }, [driveFileId]);\n\n  // Auto load default Google Drive file on app open (desktop only — มือถือ/iPad ข้ามเพื่อกัน OOM)`;
    if (app.includes(insertAfter)) app = app.replace(insertAfter, handler);
  }

  if (!app.includes('mobile-download-banner')) {
    const top = app.indexOf('      {/* Top Application Bar */}');
    if (top >= 0) {
      const hclose = app.indexOf('      </header>', top);
      if (hclose >= 0) {
        const banner = `      </header>\n\n      {isMobileUi && !model && (\n        <div className="mobile-download-banner shrink-0 z-10 px-3 py-2.5 bg-emerald-950/90 border-b border-emerald-700/50 text-emerald-50 text-sm">\n          <div className="font-semibold mb-1">มือถือ / iPad</div>\n          <p className="text-xs opacity-90 mb-2 leading-relaxed">\n            แนะนำให้ดาวน์โหลดไฟล์งานลงเครื่องก่อน แล้วเปิดด้วยแอป CAD หรือกด «เปิดไฟล์» เพื่อเลือกไฟล์จากเครื่อง\n          </p>\n          <div className="flex flex-wrap gap-2">\n            <button\n              type="button"\n              onClick={() => downloadLatestCadToDevice()}\n              disabled={isDownloadingToDevice}\n              className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white text-sm font-semibold"\n            >\n              {isDownloadingToDevice ? (\n                <RefreshCw className="w-4 h-4 animate-spin" />\n              ) : (\n                <Download className="w-4 h-4" />\n              )}\n              {isDownloadingToDevice ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลดไฟล์งาน'}\n            </button>\n            <button\n              type="button"\n              onClick={() => fileInputRef.current?.click()}\n              className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium"\n            >\n              <FolderOpen className="w-4 h-4" />\n              เปิดไฟล์จากเครื่อง\n            </button>\n          </div>\n          {driveLoadingStage && (\n            <p className="mt-2 text-[11px] opacity-80 font-mono">{driveLoadingStage}</p>\n          )}\n        </div>\n      )}\n`;
        app = app.slice(0, hclose) + banner + app.slice(hclose + '      </header>'.length);
      }
    }
  }

  // Export menu: ส่งออก DWG จาก Google Drive (ไฟล์ล่าสุด)\n  if (!app.includes('ส่งออกเป็นไฟล์ DWG')) {\n    const exportDxfBtn = `              <button\n                onClick={exportDxfFile}\n                className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-800 flex items-center gap-2 text-slate-200 cursor-pointer"\n              >\n                <FileCode2 className="w-4 h-4 text-blue-400" />\n                ส่งออกเป็นไฟล์ DXF\n              </button>`;\n    const withDwg = `              <button\n                type="button"\n                onClick={() => downloadLatestCadToDevice()}\n                disabled={isDownloadingToDevice}\n                className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-800 flex items-center gap-2 text-slate-200 cursor-pointer disabled:opacity-50"\n                title="ดาวน์โหลดไฟล์ .dwg ล่าสุดจาก Google Drive โดยตรง"\n              >\n                <Download className="w-4 h-4 text-emerald-400" />\n                {isDownloadingToDevice ? 'กำลังดาวน์โหลด DWG…' : 'ส่งออกเป็นไฟล์ DWG (Drive)'}\n              </button>\n              <button\n                onClick={exportDxfFile}\n                className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-800 flex items-center gap-2 text-slate-200 cursor-pointer"\n              >\n                <FileCode2 className="w-4 h-4 text-blue-400" />\n                ส่งออกเป็นไฟล์ DXF\n              </button>`;\n    if (app.includes(exportDxfBtn)) {\n      app = app.replace(exportDxfBtn, withDwg);\n      console.log('Added: ส่งออกเป็นไฟล์ DWG (Drive) in export menu');\n    } else {\n      console.warn('export DXF button marker not found');\n    }\n  }\n\n  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });\n  fs.writeFileSync(path.join(root, 'src/App.tsx'), app);\n  console.log('Restored src/App.tsx', app.length, 'bytes');\n\n  let canvas = await (await fetch(CANVAS_URL)).text();\n  if (!canvas.includes('getSafeDevicePixelRatio')) {\n    canvas = canvas.replace(\n      \"import { getContrastedCadColor } from '../utils/cadColors';\",\n      \"import { getContrastedCadColor } from '../utils/cadColors';\\nimport { getSafeDevicePixelRatio } from '../utils/device';\"\n    );\n  }\n  const dprOld = `    // Handle high DPI\\n    const dpr = window.devicePixelRatio || 1;\\n    const rect = canvas.getBoundingClientRect();\\n    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {\\n      canvas.width = rect.width * dpr;\\n      canvas.height = rect.height * dpr;\\n    }`;\n  const dprNew = `    // Handle high DPI — มือถือจำกัด DPR เพื่อลดแรม canvas\\n    const dpr = getSafeDevicePixelRatio();\\n    const rect = canvas.getBoundingClientRect();\\n    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {\\n      canvas.width = Math.max(1, Math.floor(rect.width * dpr));\\n      canvas.height = Math.max(1, Math.floor(rect.height * dpr));\\n    }`;\n  must(canvas, dprOld, 'dpr');\n  canvas = canvas.replace(dprOld, dprNew);\n\n  if (!canvas.includes('mobileStride')) {\n    canvas = canvas.replace(\n      '    // Viewport Culling: Compute visible CAD bounds with safety margin to skip offscreen entities',\n      `    // มือถือ: ถ้าเอนทิตีเยอะมาก ให้ข้ามบางส่วนตอนซูมออก (กันค้าง)\\n    const mobileStride =\\n      typeof window !== 'undefined' &&\\n      model.entities.length > 15000 &&\\n      (window.innerWidth < 1200 || (navigator.maxTouchPoints || 0) > 1)\\n        ? Math.max(1, Math.floor(model.entities.length / 12000))\\n        : 1;\\n\\n    // Viewport Culling: Compute visible CAD bounds with safety margin to skip offscreen entities`\n    );\n    canvas = canvas.replace(\n      `    for (const ent of model.entities) {\\n      const layer = model.layers[ent.layer];\\n      if (layer && !layer.visible) continue;`,\n      `    let _drawIdx = 0;\\n    for (const ent of model.entities) {\\n      _drawIdx++;\\n      if (mobileStride > 1 && _drawIdx % mobileStride !== 0 && ent.type === 'LINE') continue;\\n      const layer = model.layers[ent.layer];\\n      if (layer && !layer.visible) continue;`\n    );\n  }\n  if (!canvas.includes('touchAction')) {\n    canvas = canvas.replace(\n      'className=\"w-full h-full block\"',\n      \"className=\\\"w-full h-full block\\\"\\n        style={{ touchAction: 'none' }}\"\n    );\n  }\n  fs.writeFileSync(path.join(root, 'src/components/CadCanvasRenderer.tsx'), canvas);\n  console.log('Restored CadCanvasRenderer.tsx', canvas.length, 'bytes');\n}\n\nmain().catch((e) => {\n  console.error(e);\n  process.exit(1);\n});\n