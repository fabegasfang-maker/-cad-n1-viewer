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
import { convertDwgToDxf, init } from 'dwgdxf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pre-warm dwgdxf WASM once at startup (reused for all requests)
let dwgReady: Promise<void> | null = null;
function ensureDwgReady() {
  if (!dwgReady) {
    dwgReady = init().catch((err) => {
      dwgReady = null;
      throw err;
    });
  }
  return dwgReady;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(compression());
  app.use(express.json({ limit: '150mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '150mb' }));

  // API Endpoint: Convert DWG to DXF via dwgdxf (acadrust WASM)
  app.post('/api/convert-dwg', async (req, res) => {
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

      const headerStr = buffer.subarray(0, 6).toString('ascii');
      console.log(`[DWG Converter] Processing ${filename} (${buffer.length} bytes, header: ${headerStr})`);

      const startTime = Date.now();
      await ensureDwgReady();

      const dxfBytes = await convertDwgToDxf(new Uint8Array(buffer));
      const duration = Date.now() - startTime;

      if (dxfBytes && dxfBytes.byteLength > 50) {
        const dxfBuffer = Buffer.from(dxfBytes);
        const dxfBase64 = dxfBuffer.toString('base64');
        console.log(`[DWG Converter] dwgdxf produced DXF (${dxfBuffer.length} bytes, ${duration}ms)`);

        return res.json({
          success: true,
          filename: filename.replace(/\.dwg$/i, '.dxf'),
          dxfBase64,
          fileSize: dxfBuffer.length,
          duration,
          exitCode: 0,
          note: 'แปลงด้วย dwgdxf (acadrust)',
        });
      }

      return res.status(422).json({
        success: false,
        error: 'dwgdxf ไม่สามารถแปลงไฟล์ DWG นี้ได้ (ผลลัพธ์ว่างเปล่า) อาจเป็นเวอร์ชันใหม่ล่าสุดหรือมีฟีเจอร์เฉพาะของ Autodesk',
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
    res.json({ status: 'ok', dwgConverter: 'dwgdxf (acadrust)' });
  });

  // Known fallback mapping for default shared Google Drive folder
  const KNOWN_DRIVE_MAPPINGS: Record<string, { fileId: string; filename: string }> = {
    '1hetVemsG8FNfRZv9mJeDewi52j1yFoQY': {
      fileId: '1gAqglo0wVO7GozlPJhFOj0fZ4HNx1oPa',
      filename: 'แผนผังสวิทชิ่งสั่งการ 27 ตุลาคม  2569_V2007.dwg',
    },
    '1gAqglo0wVO7GozlPJhFOj0fZ4HNx1oPa': {
      fileId: '1gAqglo0wVO7GozlPJhFOj0fZ4HNx1oPa',
      filename: 'แผนผังสวิทชิ่งสั่งการ 27 ตุลาคม  2569_V2007.dwg',
    },
    '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y': {
      fileId: '1f5NtD8HsJJIK-ascuEoDCX8hKVyFo61Y',
      filename: 'แผนผังสวิทชิ่งสั่งการ 21 ตุลาคม  2569_V2007.dxf',
    },
  };

  /**
   * Resolves a Google Drive folder/file ID to a downloadable file ID and filename.
   * Scans folder for .dwg files and picks the one with the latest modified date.
   * If no .dwg is found, falls back to the latest .dxf.
   */
  async function resolvePublicDriveId(id: string): Promise<{ fileId: string; filename: string }> {
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
              const cadItems = items
                .filter((it: any) => {
                  const name = String(it[2] || '').toLowerCase();
                  return name.endsWith('.dwg') || name.endsWith('.dxf');
                })
                .map((it: any) => ({
                  fileId: String(it[0]),
                  filename: String(it[2]),
                  isDwg: String(it[2] || '').toLowerCase().endsWith('.dwg'),
                  // it[9] = modified timestamp (ms), it[10] = created timestamp (ms)
                  modifiedTime: Number(it[9]) || Number(it[10]) || 0,
                }));

              // Prioritize DWG files, sorted by modifiedTime descending (latest updated first)
              const dwgFiles = cadItems
                .filter((f) => f.isDwg)
                .sort((a, b) => b.modifiedTime - a.modifiedTime);

              if (dwgFiles.length > 0) {
                console.log(
                  `[Drive Resolver] Found latest DWG file: ${dwgFiles[0].filename} (${dwgFiles[0].fileId}, modified: ${new Date(
                    dwgFiles[0].modifiedTime
                  ).toISOString()})`
                );
                return { fileId: dwgFiles[0].fileId, filename: dwgFiles[0].filename };
              }

              // Fallback to DXF files, sorted by modifiedTime descending
              const dxfFiles = cadItems
                .filter((f) => !f.isDwg)
                .sort((a, b) => b.modifiedTime - a.modifiedTime);

              if (dxfFiles.length > 0) {
                console.log(
                  `[Drive Resolver] Found fallback latest DXF file: ${dxfFiles[0].filename} (${dxfFiles[0].fileId})`
                );
                return { fileId: dxfFiles[0].fileId, filename: dxfFiles[0].filename };
              }
            }
          } catch (ivdErr) {
            console.warn('[Drive Resolver] Error parsing _DRIVE_ivd:', ivdErr);
          }
        }

        // 2. Fallback regex match (prioritizing .dwg over .dxf)
        const dwgMatches = [...html.matchAll(/\[null,\s*"([a-zA-Z0-9_-]{20,})"\].*?"([^"]+?\.dwg)"/gi)];
        if (dwgMatches.length > 0) {
          console.log(`[Drive Resolver] Regex found DWG: ${dwgMatches[0][2]} (${dwgMatches[0][1]})`);
          return { fileId: dwgMatches[0][1], filename: dwgMatches[0][2] };
        }

        const dxfMatches = [...html.matchAll(/\[null,\s*"([a-zA-Z0-9_-]{20,})"\].*?"([^"]+?\.dxf)"/gi)];
        if (dxfMatches.length > 0) {
          console.log(`[Drive Resolver] Regex found DXF: ${dxfMatches[0][2]} (${dxfMatches[0][1]})`);
          return { fileId: dxfMatches[0][1], filename: dxfMatches[0][2] };
        }
      }
    } catch (err) {
      console.warn('[Drive Resolver] Folder scan error:', err);
    }

    if (KNOWN_DRIVE_MAPPINGS[id]) {
      return KNOWN_DRIVE_MAPPINGS[id];
    }

    return { fileId: id, filename: 'drawing.dwg' };
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
    const fileBuf = fs.readFileSync(filePath);
    const isDwg = finalName.toLowerCase().endsWith('.dwg');

    let dxfBuffer: Uint8Array;
    let dxfFilename = finalName;
    if (isDwg) {
      console.log(`[Model Parser] Converting DWG to DXF on server: ${finalName} (${(fileBuf.length / 1024 / 1024).toFixed(1)} MB)...`);
      await ensureDwgReady();
      dxfBuffer = await convertDwgToDxf(new Uint8Array(fileBuf));
      dxfFilename = finalName.replace(/\.dwg$/i, '.dxf');
      console.log(`[Model Parser] DWG converted to DXF: ${dxfFilename} (${(dxfBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      console.log(`[Model Parser] Parsing DXF on server: ${finalName}...`);
      dxfBuffer = new Uint8Array(fileBuf);
    }

    const { parseDxfFromBuffer } = await import('./src/utils/dxfProcessor');
    const parsed = parseDxfFromBuffer(
      dxfBuffer.buffer.slice(dxfBuffer.byteOffset, dxfBuffer.byteOffset + dxfBuffer.byteLength) as ArrayBuffer,
      undefined,
      dxfFilename
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
      res.setHeader('Content-Disposition', `attachment; filename=\"${encodeURIComponent(finalName)}\"`);
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
