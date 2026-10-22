/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import compression from 'compression';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// สร้าง instance ของ LibreDWG wasm ใหม่ทุกครั้งที่แปลง (หน่วยความจำสะอาด ไม่สะสมจากไฟล์ก่อนหน้า)
const createLibreDwg: () => Promise<any> = require('dwg2dxf-converter/wasm/libredwg.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(compression());
  app.use(express.json({ limit: '150mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '150mb' }));

  // API Endpoint: Convert DWG to DXF via LibreDWG WebAssembly (Robust Direct Engine)
  app.post('/api/convert-dwg', async (req, res) => {
    let wasmVirtualIn = '';
    let wasmVirtualOut = '';

    try {
      let buffer: Buffer;
      let filename = 'drawing.dwg';

      if (typeof req.query.filename === 'string') {
        filename = decodeURIComponent(req.query.filename);
      } else if (typeof req.headers['x-filename'] === 'string') {
        filename = decodeURIComponent(req.headers['x-filename']);
      }

      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (req.body?.base64) {
        buffer = Buffer.from(req.body.base64, 'base64');
        if (req.body.filename) filename = req.body.filename;
      } else {
        return res.status(400).json({ error: 'ไม่พบข้อมูลไฟล์ที่ส่งมา (No file data received)' });
      }

      if (buffer.length < 16) {
        return res.status(400).json({ error: 'ไฟล์มีขนาดเล็กเกินไปหรือไม่สมบูรณ์' });
      }

      // Check header signature
      const headerStr = buffer.subarray(0, 6).toString('ascii');
      console.log(`[DWG Converter] Processing ${filename} (${buffer.length} bytes, header: ${headerStr})`);

      const startTime = Date.now();
      const wasm = await createLibreDwg();

      // หมายเหตุ: ต้องใช้ชื่อไฟล์เสมือน "สั้นๆ" เท่านั้น
      // ชื่อยาว (เช่น input_<timestamp>_<random>.dwg) ทำให้ wasm ของ LibreDWG
      // เกิด "memory access out of bounds" ได้ เนื่องจากสร้าง instance แยกต่อคำขอ จึงไม่ชนกัน
      wasmVirtualIn = 'in.dwg';
      wasmVirtualOut = 'out.dxf';

      // Write DWG to Wasm virtual filesystem
      wasm.FS.writeFile(wasmVirtualIn, buffer);

      // Execute LibreDWG dwg2dxf safely
      let exitCode = -1;
      try {
        const convertFn = wasm.cwrap('convert_dwg_to_dxf', 'number', ['string', 'string']);
        exitCode = convertFn(wasmVirtualIn, wasmVirtualOut);
        console.log(`[DWG Converter] LibreDWG finished with exit code ${exitCode}`);
      } catch (convErr: any) {
        console.error('[DWG Converter] LibreDWG convertFn error:', convErr);
      }

      // Check if output DXF exists in virtual filesystem
      let outputBuffer: Uint8Array | null = null;
      try {
        outputBuffer = wasm.FS.readFile(wasmVirtualOut);
      } catch (readErr) {
        console.warn('[DWG Converter] virtualOut not found or unreadable:', readErr);
      }

      const duration = Date.now() - startTime;

      // If outputBuffer has valid content, use it!
      if (outputBuffer && outputBuffer.length > 50) {
        const dxfBuffer = Buffer.from(outputBuffer);
        const dxfBase64 = dxfBuffer.toString('base64');
        console.log(`[DWG Converter] Successfully produced DXF (${dxfBuffer.length} bytes, ${duration}ms)`);

        return res.json({
          success: true,
          filename: filename.replace(/\.dwg$/i, '.dxf'),
          dxfBase64,
          fileSize: dxfBuffer.length,
          duration,
          exitCode,
          note: exitCode !== 0 ? 'แปลงสำเร็จ (กู้คืนเอนทิตีที่รองรับโดย LibreDWG)' : 'แปลงสมบูรณ์ 100%',
        });
      }

      // If no DXF output was produced, explain why with clear actionable steps
      return res.status(422).json({
        success: false,
        error: `LibreDWG ไม่สามารถแปลงไฟล์ DWG นี้ได้ (รหัส: ${exitCode}) อาจเป็นเวอร์ชันใหม่ล่าสุดหรือมีฟีเจอร์เฉพาะของ Autodesk`,
        exitCode,
        suggestion: 'แนะนำให้เปิดไฟล์ใน AutoCAD แล้วสั่ง File -> Save As -> เลือกรูปแบบ "AutoCAD 2018 DXF (*.dxf)" หรือ "AutoCAD 2007 DXF (*.dxf)" แล้วนำมาเปิดได้ทันที 100%',
      });
    } catch (err: any) {
      console.error('[DWG Converter] Fatal error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'เกิดข้อผิดพลาดในการประมวลผลไฟล์ DWG',
      });
    }
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', dwgConverter: 'dwg2dxf-converter wasm' });
  });

  // Known mapping for default shared Google Drive folder
  const KNOWN_DRIVE_MAPPINGS: Record<string, { fileId: string; filename: string }> = {
    '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY': {
      fileId: '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y',
      filename: 'แผนผังสวิทชิ่งสั่งการ 21 ตุลาคม  2569_V2007.dxf',
    },
    '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y': {
      fileId: '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y',
      filename: 'แผนผังสวิทชิ่งสั่งการ 21 ตุลาคม  2569_V2007.dxf',
    },
  };

  /**
   * Resolves a Google Drive folder/file ID to a downloadable file ID and filename
   */
  async function resolvePublicDriveId(id: string): Promise<{ fileId: string; filename: string }> {
    if (KNOWN_DRIVE_MAPPINGS[id]) {
      return KNOWN_DRIVE_MAPPINGS[id];
    }

    try {
      const folderUrl = `https://drive.google.com/drive/folders/${id}`;
      const res = await fetch(folderUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (res.ok) {
        const html = await res.text();

        // 1. Check Google Drive initial folder data structure (_DRIVE_ivd)
        const ivdMatch = html.match(/_DRIVE_ivd'\]\s*=\s*'([^']+)/);
        if (ivdMatch) {
          try {
            const unescaped = ivdMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16))
            );
            const parsed = JSON.parse(unescaped);
            const items = parsed[0];
            if (Array.isArray(items)) {
              const cadItem = items.find((it: any) => {
                const name = String(it[2] || '').toLowerCase();
                return name.endsWith('.dxf') || name.endsWith('.dwg');
              });
              if (cadItem) {
                console.log(`[Drive Resolver] Found CAD file in folder: ${cadItem[2]} (${cadItem[0]})`);
                return { fileId: cadItem[0], filename: cadItem[2] };
              }
            }
          } catch (ivdErr) {
            console.warn('[Drive Resolver] Error parsing _DRIVE_ivd:', ivdErr);
          }
        }

        // 2. Fallback regex match
        const matches = [...html.matchAll(/\[null,\s*"([a-zA-Z0-9_-]{20,})"\].*?"([^"]+?\.(?:dxf|dwg))"/gi)];
        if (matches.length > 0) {
          const cadMatch =
            matches.find(
              (m) => m[2].toLowerCase().endsWith('.dxf') || m[2].toLowerCase().endsWith('.dwg')
            ) || matches[0];
          return { fileId: cadMatch[1], filename: cadMatch[2] };
        }
      }
    } catch (err) {
      console.warn('[Drive Resolver] Folder scan error:', err);
    }

    return { fileId: id, filename: 'drawing.dxf' };
  }

  /**
   * Downloads a public Google Drive file (handling virus-scan confirmation for large files > 100MB)
   */
  async function getOrDownloadPublicDriveFile(
    fileId: string,
    preferredFilename: string
  ): Promise<{ filePath: string; filename: string }> {
    const cacheDir = path.join(os.tmpdir(), 'cad_drive_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Check if file already cached
    const files = fs.readdirSync(cacheDir);
    const existing = files.find((f) => f.startsWith(`${fileId}_`));
    if (existing) {
      const existingPath = path.join(cacheDir, existing);
      if (fs.statSync(existingPath).size > 100) {
        const filename = existing.substring(fileId.length + 1);
        console.log(`[Drive Cache] Hit cache for ${fileId}: ${filename}`);
        return { filePath: existingPath, filename };
      }
    }

    // Check /tmp/pea_sample.dxf fallback
    if (fileId === '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y' && fs.existsSync('/tmp/pea_sample.dxf')) {
      const targetPath = path.join(cacheDir, `${fileId}_${preferredFilename}`);
      fs.copyFileSync('/tmp/pea_sample.dxf', targetPath);
      return { filePath: targetPath, filename: preferredFilename };
    }

    const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
    console.log(`[Drive Download] Requesting ${directUrl}...`);

    const res1 = await fetch(directUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const cookie = res1.headers.get('set-cookie') || '';
    const contentType = res1.headers.get('content-type') || '';

    let actualFilename = preferredFilename;
    let downloadUrl = directUrl;

    if (contentType.includes('text/html')) {
      const html = await res1.text();
      const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
      const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
      const nameMatch = html.match(/<a[^>]*href="\/open\?id=[^"]*"[^>]*>([^<]+)<\/a>/);

      if (nameMatch) {
        actualFilename = nameMatch[1].trim();
      }
      const uuid = uuidMatch ? uuidMatch[1] : '';
      const confirm = confirmMatch ? confirmMatch[1] : 't';

      downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirm}&uuid=${uuid}`;
      console.log(`[Drive Download] Large file bypass confirmed (${actualFilename}), downloading...`);
    }

    const targetPath = path.join(cacheDir, `${fileId}_${actualFilename}`);
    const dest = fs.createWriteStream(targetPath);

    const resDownload = await fetch(downloadUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (!resDownload.ok || !resDownload.body) {
      throw new Error(`Google Drive download failed with status ${resDownload.status}`);
    }

    // @ts-ignore
    const { Readable } = await import('stream');
    // @ts-ignore
    Readable.fromWeb(resDownload.body).pipe(dest);

    await new Promise<void>((resolve, reject) => {
      dest.on('finish', () => resolve());
      dest.on('error', reject);
    });

    console.log(`[Drive Download] Finished downloading ${actualFilename} (${fs.statSync(targetPath).size} bytes)`);
    return { filePath: targetPath, filename: actualFilename };
  }

  // Cache in-memory or on disk for lightning-fast delivery of pre-parsed CAD model
  async function getOrParseCadModelFile(fileId: string, filename: string): Promise<string> {
    const cacheDir = path.join(os.tmpdir(), 'cad_drive_cache');
    const responsePath = path.join(cacheDir, `response_${fileId}.json`);

    if (fs.existsSync(responsePath)) {
      try {
        const stats = fs.statSync(responsePath);
        if (stats.size > 500) {
          console.log(`[Model Cache] Found response envelope for ${fileId} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
          return responsePath;
        }
      } catch (e) {
        console.warn('[Model Cache] Stat error:', e);
      }
    }

    // If response envelope not found, check raw file & parse
    const { filePath, filename: finalName } = await getOrDownloadPublicDriveFile(fileId, filename);
    console.log(`[Model Parser] Parsing DXF on server: ${finalName}...`);
    const fileBuf = fs.readFileSync(filePath);

    const { parseDxfFromBuffer } = await import('./src/utils/dxfProcessor');
    const parsed = parseDxfFromBuffer(
      fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength),
      undefined,
      finalName
    );

    const envelope = {
      success: true,
      fileId,
      filename: finalName,
      model: parsed,
    };

    fs.writeFileSync(responsePath, JSON.stringify(envelope));
    console.log(`[Model Cache] Saved response envelope to ${responsePath}`);
    return responsePath;
  }

  // API Endpoint: Get parsed CAD model directly (supports GET & POST)
  const handleCadModelRequest = async (req: express.Request, res: express.Response) => {
    try {
      const rawId = (req.body?.id || (req.query.id as string) || '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY').trim();
      console.log(`[API /api/drive-cad-model] Request for Google Drive ID: ${rawId}`);

      const { fileId, filename } = await resolvePublicDriveId(rawId);
      const responsePath = await getOrParseCadModelFile(fileId, filename);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('x-cad-filename', encodeURIComponent(filename));
      res.setHeader('x-cad-file-id', fileId);
      res.setHeader('Access-Control-Expose-Headers', 'x-cad-filename, x-cad-file-id');

      return res.sendFile(responsePath);
    } catch (err: any) {
      console.error('[API /api/drive-cad-model] Error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'ไม่สามารถประมวลผลไฟล์ CAD ได้',
      });
    }
  };

  app.get('/api/drive-cad-model', handleCadModelRequest);
  app.post('/api/drive-cad-model', handleCadModelRequest);

  // API Endpoint: Fetch public Google Drive CAD file or folder without requiring user login
  const handleDriveFileRequest = async (req: express.Request, res: express.Response) => {
    try {
      const rawId = (req.body?.id || (req.query.id as string) || '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY').trim();
      console.log(`[API /api/drive-file] Request for Google Drive ID: ${rawId}`);

      const { fileId, filename } = await resolvePublicDriveId(rawId);
      const { filePath, filename: finalName } = await getOrDownloadPublicDriveFile(fileId, filename);

      const isDwg = finalName.toLowerCase().endsWith('.dwg');
      res.setHeader('Content-Type', isDwg ? 'application/octet-stream' : 'application/dxf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalName)}"`);
      res.setHeader('x-cad-filename', encodeURIComponent(finalName));
      res.setHeader('x-cad-file-id', fileId);
      res.setHeader('Access-Control-Expose-Headers', 'x-cad-filename, x-cad-file-id, Content-Disposition');

      return res.sendFile(filePath);
    } catch (err: any) {
      console.error('[API /api/drive-file] Error:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'ไม่สามารถดาวน์โหลดไฟล์จาก Google Drive ได้',
      });
    }
  };

  app.get('/api/drive-file', handleDriveFileRequest);
  app.post('/api/drive-file', handleDriveFileRequest);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
