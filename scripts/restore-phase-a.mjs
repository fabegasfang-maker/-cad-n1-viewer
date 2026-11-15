#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b64 = [
  "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"
].join('');
const out = path.join(__dirname, '_restore_expanded.mjs');
fs.writeFileSync(out, zlib.gunzipSync(Buffer.from(b64, 'base64')));
await import(pathToFileURL(out).href);
