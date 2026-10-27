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

  // PLACEHOLDER - content too large for this test, will fix next
  return <div>Phase A restore in progress</div>;
}
