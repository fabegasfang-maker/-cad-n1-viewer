/**
 * ซ่อมไฟล์ DXF ที่ LibreDWG เขียนออกมา
 *
 * ปัญหา: LibreDWG เขียนข้อความ MTEXT/TEXT ที่มีตัวขึ้นบรรทัดใหม่ดิบ (LF เดี่ยวๆ) ลงในไฟล์ตรงๆ
 * ขณะที่โครงสร้าง DXF ทั้งไฟล์ใช้ CRLF และเป็นคู่ "บรรทัด group code / บรรทัดค่า"
 * LF ที่หลงมาจึงทำให้ตัวอ่านที่แยกด้วยบรรทัดนับคู่เพี้ยน (code กลายเป็นค่า ค่ากลายเป็น code)
 * เอนทิตีที่ตามมาจนกว่าจะมี LF ดิบตัวถัดไปจะถูกอ่านผิดหรือหายไป
 *
 * วิธีแก้: ทุก LF ที่ไม่มี CR นำหน้า ถือเป็นตัวขึ้นบรรทัดใหม่ในข้อความ แทนด้วย `\P`
 * (ตัวคั่นย่อหน้าของ MTEXT) ส่วน CR เดี่ยวๆ แทนด้วยช่องว่าง
 */
export function repairLibreDwgDxf(input: ArrayBuffer): { buffer: ArrayBuffer; fixed: number } {
  const src = new Uint8Array(input);
  const n = src.length;

  // รอบแรก: นับจุดที่ต้องซ่อม (ถ้าไม่มี คืน buffer เดิมโดยไม่คัดลอก)
  let loneLf = 0;
  let loneCr = 0;
  for (let i = 0; i < n; i++) {
    const b = src[i];
    if (b === 10) {
      if (i === 0 || src[i - 1] !== 13) loneLf++;
    } else if (b === 13) {
      if (i + 1 >= n || src[i + 1] !== 10) loneCr++;
    }
  }
  if (loneLf === 0 && loneCr === 0) return { buffer: input, fixed: 0 };

  // รอบสอง: เขียนผลลัพธ์ (`\P` ยาว 2 ไบต์ แทน LF 1 ไบต์ ส่วน CR เดี่ยวคงความยาวเดิม)
  const out = new Uint8Array(n + loneLf);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const b = src[i];
    if (b === 10 && (i === 0 || src[i - 1] !== 13)) {
      out[o++] = 0x5c; // '\'
      out[o++] = 0x50; // 'P'
    } else if (b === 13 && (i + 1 >= n || src[i + 1] !== 10)) {
      out[o++] = 0x20;
    } else {
      out[o++] = b;
    }
  }
  // o === n + loneLf พอดี จึงคืน buffer ได้เลยโดยไม่ต้องคัดลอกซ้ำ (สำคัญกับมือถือ)
  return { buffer: out.buffer as ArrayBuffer, fixed: loneLf + loneCr };
}
