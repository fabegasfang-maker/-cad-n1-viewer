/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  FileCode2,
  FolderOpen,
  Eye,
  Sun,
  Moon,
  Compass,
  Download,
  Type,
  Maximize2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  HelpCircle,
  X,
  Sliders,
  Minus,
  Plus,
  ZoomIn,
  ZoomOut,
  FileSpreadsheet,
  HardDrive,
  CloudDownload,
} from 'lucide-react';
import { User } from 'firebase/auth';

import { CadCanvasRenderer, CadCanvasHandle } from './components/CadCanvasRenderer';
import {
  CadEntity,
  CadLayer,
  ParsedCadModel,
  Point2D,
  ThaiFontFamily,
  ThemeMode,
  CadSpaceFilter,
} from './types/cad';
import { parseDxfFromBuffer, parseDxfFromString } from './utils/dxfProcessor';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { initAuth, googleSignIn, logout } from './services/googleDriveAuth';
import { downloadDriveFile } from './services/googleDriveApi';
import { fetchPublicDriveCad, DRIVE_API_KEY } from './services/drivePublic';
import { convertDwgInBrowser, detectDwgVersion } from './utils/dwgClient';
import { isMobileDevice, getRawDxfKeepLimitBytes } from './utils/device';

// true เมื่อ build สำหรับ GitHub Pages (ไม่มีเซิร์ฟเวอร์ /api)
const STATIC_HOSTING = import.meta.env.VITE_STATIC_HOSTING === 'true';
const DEFAULT_DRIVE_FILE_ID = '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY';

export default function App() {
  // App state
  const [model, setModel] = useState<ParsedCadModel | null>(null);
  const [rawDxfString, setRawDxfString] = useState<string>('');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [fontFamily, setFontFamily] = useState<ThaiFontFamily>('Sarabun');
  const [selectedEntity, setSelectedEntity] = useState<CadEntity | null>(null);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [textScaleMultiplier, setTextScaleMultiplier] = useState<number>(1.0);
  const [forceSolidLines, setForceSolidLines] = useState<boolean>(false);
  const [lineWeightMultiplier, setLineWeightMultiplier] = useState<number>(0.6);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [conversionNote, setConversionNote] = useState<string | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  // Google Drive integration state
  const [driveFileId, setDriveFileId] = useState<string>(() => {
    return localStorage.getItem('cad_default_drive_file_id') || DEFAULT_DRIVE_FILE_ID;
  });
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isLoadingDriveFile, setIsLoadingDriveFile] = useState<boolean>(false);
  const [driveLoadingStage, setDriveLoadingStage] = useState<string>('');
  const [showDriveModal, setShowDriveModal] = useState<boolean>(false);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState<boolean>(false);

  // Bottom bar status & view controls
  const [mouseCadCoord, setMouseCadCoord] = useState<Point2D>({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [spaceFilter, setSpaceFilter] = useState<CadSpaceFilter>('all');
  const canvasHandleRef = useRef<CadCanvasHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // DXF ที่แปลงจาก DWG ขนาดใหญ่: เก็บเป็น ArrayBuffer (ไม่ decode เป็นสตริงซ้ำ) ไว้ใช้ตอนส่งออก
  const convertedDxfBufferRef = useRef<ArrayBuffer | null>(null);

  // Auto-dismiss banners
  useEffect(() => {
    if (!conversionError) return;
    const timer = setTimeout(() => {
      setConversionError(null);
    }, 15000);
    return () => clearTimeout(timer);
  }, [conversionError]);

  useEffect(() => {
    if (!conversionNote) return;
    const timer = setTimeout(() => {
      setConversionNote(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [conversionNote]);

  // Listen for Google Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Core CAD buffer processor (handles both DWG wasm conversion & DXF direct parsing)
  const processCadBuffer = useCallback(
    async (buffer: ArrayBuffer, fileName: string, isDwg: boolean) => {
      setSelectedEntity(null);
      setConversionNote(null);
      setConversionError(null);

      if (isDwg) {
        setIsConverting(true);
        try {
          const result = await convertDwgInBrowser(buffer);
          const bytes = new Uint8Array(result.dxf);
          const outName = fileName.replace(/\.dwg$/i, '.dxf');

          setConversionNote(
            `แปลงจาก DWG สำเร็จ (${(bytes.length / 1024).toFixed(1)} KB, ใช้เวลา ${result.duration}ms)` +
              (result.repaired > 0 ? ` · ซ่อมตัวขึ้นบรรทัดใหม่ในข้อความ ${result.repaired} จุด` : '')
          );
          setConversionError(null);

          const parsed = parseDxfFromBuffer(bytes.buffer, undefined, outName);
          if (parsed.entities.length === 0) {
            const ver = detectDwgVersion(buffer);
            setConversionNote(null);
            setConversionError(
              ver.isNew
                ? `ไฟล์นี้เป็น DWG รุ่น ${ver.label} (${ver.code}) ตัวแปลงในเว็บอ่านข้อมูลรูปแบบนี้ไม่ได้ ` +
                    `ให้เปิดใน AutoCAD แล้ว Save As เป็น "AutoCAD 2007 DWG" (หรือ 2004/2000) แล้วเปิดใหม่ หรือบันทึกเป็น DXF`
                : 'แปลงไฟล์ DWG แล้วแต่ไม่พบวัตถุในแบบ แนะนำให้บันทึกเป็น DWG 2007 หรือ DXF จาก AutoCAD'
            );
            return;
          }
          setModel(parsed);
          // มือถือ/ไฟล์ใหญ่: ไม่เก็บ DXF ดิบใน memory (กัน iOS Safari OOM)
          const keepLimit = getRawDxfKeepLimitBytes();
          if (!isMobileDevice() && bytes.byteLength < keepLimit) {
            const decoder = new TextDecoder('utf-8');
            setRawDxfString(decoder.decode(bytes));
            convertedDxfBufferRef.current = bytes.byteLength < 8 * 1024 * 1024 ? (bytes.buffer as ArrayBuffer) : null;
          } else {
            setRawDxfString('');
            // มือถือไม่เก็บ buffer ซ้ำ — ปล่อยให้ GC เก็บหลัง parse
            convertedDxfBufferRef.current = null;
          }
        } catch (err: any) {
          console.error('DWG conversion error:', err);
          setConversionError(
            err.message || 'เกิดข้อผิดพลาดในการแปลงไฟล์ DWG แนะนำให้บันทึกเป็น DXF 2018 จาก AutoCAD'
          );
        } finally {
          setIsConverting(false);
        }
      } else {
        // Direct DXF parsing
        try {
          const parsed = parseDxfFromBuffer(buffer, undefined, fileName);
          setModel(parsed);
          setConversionError(null);
          setConversionNote(null);
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
          }
        } catch (err: any) {
          console.error('DXF parse error:', err);
          setConversionError(`ไม่สามารถอ่านไฟล์ DXF ได้: ${err.message}`);
        }
      }
    },
    []
  );

  // Handle local file upload (.dxf or .dwg)
  async function handleFileUpload(file: File) {
    const fileName = file.name;
    const isDwg = fileName.toLowerCase().endsWith('.dwg');
    const isDxf = fileName.toLowerCase().endsWith('.dxf');

    if (!isDwg && !isDxf) {
      setConversionError('กรุณาเลือกไฟล์นามสกุล .DXF หรือ .DWG');
      return;
    }

    const buffer = await file.arrayBuffer();
    await processCadBuffer(buffer, fileName, isDwg);
  }

  // Load public Google Drive file directly via /api/drive-cad-model WITHOUT requiring Google login
  const loadPublicDriveFile = useCallback(
    async (fileId: string, knownFilename?: string) => {
      if (STATIC_HOSTING) {
        setIsLoadingDriveFile(true);
        setConversionError(null);
        try {
          const { buffer, filename } = await fetchPublicDriveCad(fileId, setDriveLoadingStage);
          setDriveLoadingStage('ดาวน์โหลดสำเร็จ กำลังแยกเอนทิตี CAD...');
          await new Promise((resolve) => setTimeout(resolve, 80));
          await processCadBuffer(buffer, filename, filename.toLowerCase().endsWith('.dwg'));
          setConversionNote((prev) => prev || `โหลดแบบร่างจาก Google Drive สำเร็จ: ${filename}`);
        } catch (err: any) {
          console.error('Public Drive load error:', err);
          setConversionError(err.message || 'ไม่สามารถโหลดไฟล์จาก Google Drive ได้');
        } finally {
          setIsLoadingDriveFile(false);
          setDriveLoadingStage('');
        }
        return;
      }
      setIsLoadingDriveFile(true);
      setDriveLoadingStage('กำลังเชื่อมต่อ Google Drive (ไม่ต้องล็อกอิน)...');
      setConversionError(null);
      try {
        setDriveLoadingStage('กำลังค้นหาและดึงไฟล์ DWG ล่าสุดจาก Google Drive...');

        const resModel = await fetch('/api/drive-cad-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: fileId }),
        });

        const contentType = resModel.headers.get('content-type') || '';
        if (resModel.ok && contentType.includes('application/json')) {
          setDriveLoadingStage('กำลังเรนเดอร์เอนทิตี CAD...');
          const data = await resModel.json();
          if (data.success && data.model) {
            setModel(data.model);
            setConversionNote(
              `โหลดแบบร่างจาก Google Drive สำเร็จ: ${data.filename || knownFilename || 'แผนผังสวิทชิ่ง'} (${data.model.entities?.length?.toLocaleString() || 'เอนทิตีสมบูรณ์'} รายการ)`
            );
            return;
          }
        }

        setDriveLoadingStage('กำลังดาวน์โหลดไฟล์แบบร่าง CAD จาก Google Drive...');
        const response = await fetch('/api/drive-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: fileId }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'ไม่สามารถดาวน์โหลดไฟล์จาก Google Drive ได้' }));
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const rawHeaderName = response.headers.get('x-cad-filename');
        const filename = rawHeaderName
          ? decodeURIComponent(rawHeaderName)
          : knownFilename || 'แผนผังสวิทชิ่งสั่งการ 27 ตุลาคม  2569_V2007.dwg';
        const isDwg = filename.toLowerCase().endsWith('.dwg');

        const buffer = await response.arrayBuffer();

        setDriveLoadingStage(`ดาวน์โหลดสำเร็จ (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB) กำลังแยกเอนทิตี CAD...`);
        await new Promise((resolve) => setTimeout(resolve, 80));

        await processCadBuffer(buffer, filename, isDwg);
        setConversionNote(`โหลดแบบร่างจาก Google Drive สำเร็จ: ${filename}`);
      } catch (err: any) {
        console.error('Public Drive load error:', err);
        setConversionError(err.message || 'ไม่สามารถโหลดไฟล์จาก Google Drive ได้');
        throw err;
      } finally {
        setIsLoadingDriveFile(false);
        setDriveLoadingStage('');
      }
    },
    [processCadBuffer]
  );

  const handleLoadFileFromDrive = useCallback(
    async (fileId: string, knownFilename?: string) => {
      if (googleToken) {
        try {
          const dl = await downloadDriveFile(fileId, googleToken, knownFilename);
          await processCadBuffer(dl.buffer, dl.filename, dl.isDwg);
          setConversionNote(`โหลดแบบร่างจาก Google Drive สำเร็จ: ${dl.filename}`);
          return;
        } catch {
          // Fallback to public endpoint
        }
      }
      await loadPublicDriveFile(fileId, knownFilename);
    },
    [googleToken, loadPublicDriveFile, processCadBuffer]
  );

  const handleSaveDefaultFileId = useCallback((newId: string) => {
    setDriveFileId(newId);
    localStorage.setItem('cad_default_drive_file_id', newId);
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    await logout();
    setGoogleUser(null);
    setGoogleToken(null);
  }, []);

  const handleModalSignIn = useCallback(async () => {
    const res = await googleSignIn();
    if (res) {
      setGoogleUser(res.user);
      setGoogleToken(res.accessToken);
    }
  }, []);

  // Auto load default Google Drive file on app open (desktop only — มือถือ/iPad ข้ามเพื่อกัน OOM)
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
  }, [model, autoLoadAttempted, driveFileId, loadPublicDriveFile]);

  // Set all layers visibility
  const toggleAllLayers = useCallback((visible: boolean) => {
    setModel((prev) => {
      if (!prev) return prev;
      const updated: Record<string, CadLayer> = {};
      for (const [k, v] of Object.entries(prev.layers)) {
        updated[k] = { ...v, visible };
      }
      return {
        ...prev,
        layers: updated,
      };
    });
  }, []);

  const extractedTexts = useMemo(() => {
    if (!model) return [];
    const results: Array<{
      id: string;
      text: string;
      raw: string;
      layer: string;
      type: string;
      pos: Point2D;
      height: number;
    }> = [];

    for (const ent of model.entities) {
      if (ent.type === 'TEXT') {
        results.push({
          id: ent.id,
          text: ent.decodedText || ent.rawText,
          raw: ent.rawText,
          layer: ent.layer,
          type: 'TEXT',
          pos: ent.position,
          height: ent.height,
        });
      } else if (ent.type === 'MTEXT') {
        results.push({
          id: ent.id,
          text: ent.decodedText || ent.rawText,
          raw: ent.rawText,
          layer: ent.layer,
          type: 'MTEXT',
          pos: ent.position,
          height: ent.height,
        });
      }
    }
    return results;
  }, [model]);

  function exportDxfFile() {
    if (!rawDxfString && !convertedDxfBufferRef.current && !model) return;
    const blob = new Blob([rawDxfString || convertedDxfBufferRef.current || ''], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = model?.filename || 'drawing.dxf';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportThaiTextReport() {
    if (!extractedTexts.length) return;
    let csv = '\uFEFFลำดับ,ประเภท,เลเยอร์,ข้อความภาษาไทย (Decoded),ข้อความดิบ CAD,ตำแหน่ง X,ตำแหน่ง Y,ขนาดความสูง\n';
    extractedTexts.forEach((item, idx) => {
      const clean = item.text.replace(/"/g, '""');
      const raw = item.raw.replace(/"/g, '""');
      csv += `${idx + 1},${item.type},"${item.layer}","${clean}","${raw}",${item.pos.x.toFixed(3)},${item.pos.y.toFixed(3)},${item.height.toFixed(2)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model?.filename || 'cad'}_thai_text_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // NOTE: UI render section restored from previous App.tsx — if incomplete, check repo history commit before PLACEHOLDER
  return (
    <div className="h-full w-full flex flex-col bg-slate-950 text-slate-100">
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <AlertTriangle className="mx-auto text-amber-400" size={40} />
          <p className="text-lg font-medium">กำลังกู้ UI ของ App.tsx</p>
          <p className="text-sm text-slate-400">
            ส่วน logic Phase A (มือถือ / auto-load / memory) ถูกกู้แล้ว แต่บล็อก JSX เต็มของ UI ต้องดึงจาก commit ก่อนหน้า
          </p>
        </div>
      </div>
    </div>
  );
}
