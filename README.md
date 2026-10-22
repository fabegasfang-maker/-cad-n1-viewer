# N1 CAD Viewer (DWG / DXF + ภาษาไทย)

เปิดดูไฟล์ .DXF และ .DWG บนเบราว์เซอร์ แปลง DWG ในเครื่องผู้ใช้เอง (LibreDWG WebAssembly) ไม่ต้องมีเซิร์ฟเวอร์

## Deploy บน GitHub Pages
1. อัปโหลดไฟล์ทั้งหมดขึ้น repo (branch `main`)
2. Settings → Pages → Source เลือก **GitHub Actions**
3. รอ Actions รันเสร็จ (แท็บ Actions) เว็บจะอยู่ที่ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`
4. ถ้าจะใช้ปุ่ม Google Drive (ล็อกอิน): Firebase Console → Authentication → Settings → Authorized domains → เพิ่ม `<ชื่อผู้ใช้>.github.io`

## รันในเครื่อง
`npm install` แล้ว `npm run dev` (โหมดนี้ใช้ server.ts ซึ่งรองรับโหลด Drive แบบไม่ล็อกอินด้วย)

## โหลดไฟล์จาก Google Drive แบบไม่ต้องล็อกอิน (บน GitHub Pages)
1. Google Cloud Console → เปิดใช้ **Google Drive API** → สร้าง **API key** (จำกัดให้ใช้ได้เฉพาะ Drive API และเฉพาะโดเมน `https://ชื่อผู้ใช้.github.io/*`)
2. GitHub repo → Settings → Secrets and variables → Actions → แท็บ **Variables** → New repository variable ชื่อ `VITE_GOOGLE_API_KEY` ใส่ค่า key
3. ไฟล์/โฟลเดอร์บน Drive ต้องแชร์เป็น "ทุกคนที่มีลิงก์ (Anyone with the link)"
