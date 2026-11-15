// ดูรายชื่อไฟล์ใน Drive เทียบกับสิ่งที่ผังเลือก (ไม่สร้างผัง ใช้เวลาไม่ถึงนาที)
const API = 'https://www.googleapis.com/drive/v3/files';
const KEY = process.env.GOOGLE_API_KEY || '';
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1mP47qarQZxPF-ln5Dy7VZrJlcq0uPJ4D';
const HEADERS = process.env.SITE_URL ? { Referer: `${process.env.SITE_URL.replace(/\/$/, '')}/` } : {};
const bkk = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' (เวลาไทย)';

async function list(id, extra = '') {
  const q = encodeURIComponent(`'${id}' in parents and trashed=false${extra}`);
  const r = await fetch(`${API}?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,createdTime,parents)&orderBy=modifiedTime desc&pageSize=60&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(KEY)}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  return (await r.json()).files || [];
}
const show = (f) => console.log(`  ${f.name} | ${(Number(f.size || 0) / 1048576).toFixed(1)} MB | แก้ไข ${f.modifiedTime} = ${bkk(f.modifiedTime)} | สร้าง ${f.createdTime}`);

console.log('now:', new Date().toISOString(), '=', bkk(new Date().toISOString()));
const root = await list(FOLDER_ID);
console.log(`--- ราก (${root.length} รายการ) ---`);
const folders = root.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
for (const f of root.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').slice(0, 8)) show(f);
for (const f of folders.filter((x) => /พฤศจิกายน/.test(x.name) || /2569/.test(x.name)).slice(0, 3)) {
  console.log(`--- โฟลเดอร์ "${f.name}" (id ${f.id}) แก้ไข ${f.modifiedTime} ---`);
  for (const x of (await list(f.id)).slice(0, 12)) show(x);
}
// ค้นไฟล์ที่ชื่อมี "15 พฤศจิกายน" ทุกที่ที่คีย์นี้มองเห็น
const q = encodeURIComponent(`name contains '15 พฤศจิกายน' and trashed=false`);
const r = await fetch(`${API}?q=${q}&fields=files(id,name,modifiedTime,parents,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&key=${encodeURIComponent(KEY)}`, { headers: HEADERS });
console.log(`--- ค้นชื่อ "15 พฤศจิกายน": HTTP ${r.status} ---`);
console.log(JSON.stringify(r.ok ? (await r.json()).files : (await r.text()).slice(0, 300), null, 1));
