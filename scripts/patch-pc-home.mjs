#!/usr/bin/env node
/**
 * แทรกปุ่มไอคอนบ้าน (กลับหน้าแรก) ไว้หน้าสุดของแถบเครื่องมือโหมด PC (src/App.tsx)
 *
 * src/App.tsx ถูกสร้างใหม่ทุกครั้งที่ build โดย scripts/restore-phase-a.mjs
 * ดังนั้นการแก้ต้องทำหลังขั้นตอน restore ด้วยสคริปต์นี้ (รันซ้ำได้ ไม่แทรกซ้ำ)
 * หาตำแหน่งไม่เจอ = แจ้งเตือนแล้วข้าม ไม่ทำให้ build ล้ม
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/App.tsx');

function skip(msg) {
  console.warn(`::warning::patch-pc-home: ${msg} → ข้าม (ไม่มีปุ่มบ้านในโหมด PC)`);
  process.exit(0);
}

if (!fs.existsSync(file)) skip('ไม่พบ src/App.tsx');
let app = fs.readFileSync(file, 'utf8');
if (app.includes('data-home-link')) {
  console.log('patch-pc-home: มีปุ่มบ้านอยู่แล้ว');
  process.exit(0);
}

// 1) import ไอคอน Home จาก lucide-react
const importRe = /(\n\s*Search,)(\s*\n\}\s*from 'lucide-react';)/;
if (!importRe.test(app)) skip('ไม่พบรายการ import ของ lucide-react');
if (!/\bHome\b/.test(app.match(/import \{[\s\S]*?\} from 'lucide-react';/)[0])) {
  app = app.replace(importRe, '$1\n  Home,$2');
}

// 2) แทรกปุ่มเป็นลูกแรกของกลุ่มซ้ายใน <header>
const h = app.indexOf('<header ');
if (h < 0) skip('ไม่พบ <header>');
const anchor = '<div className="flex items-center gap-3">';
const a = app.indexOf(anchor, h);
const hEnd = app.indexOf('</header>', h);
if (a < 0 || (hEnd > 0 && a > hEnd)) skip('ไม่พบกลุ่มซ้ายของ <header>');
const eol = app.indexOf('\n', a) + 1;
const btn =
  '          <a\n' +
  '            data-home-link\n' +
  '            href="./"\n' +
  '            title="หน้าแรก"\n' +
  '            aria-label="กลับหน้าแรก"\n' +
  '            className="w-9 h-9 shrink-0 rounded-lg border border-slate-500/50 bg-slate-500/10 hover:bg-slate-500/25 flex items-center justify-center transition cursor-pointer"\n' +
  '          >\n' +
  '            <Home className="w-5 h-5" />\n' +
  '          </a>\n';
app = app.slice(0, eol) + btn + app.slice(eol);
fs.writeFileSync(file, app);
console.log('patch-pc-home: เพิ่มปุ่มบ้านในแถบเครื่องมือโหมด PC แล้ว');
