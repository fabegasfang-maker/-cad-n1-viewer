#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b64 = (fs.readFileSync(path.join(__dirname, 'p0.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p1.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p2.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p3.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p4.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p5.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p6.b64'), 'utf8') + fs.readFileSync(path.join(__dirname, 'p7.b64'), 'utf8')).replace(/\s+/g, '');
const out = path.join(__dirname, '_restore_expanded.mjs');
fs.writeFileSync(out, zlib.gunzipSync(Buffer.from(b64, 'base64')));
await import(pathToFileURL(out).href);
