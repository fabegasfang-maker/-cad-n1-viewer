#!/usr/bin/env python3
"""DXF -> PDF แบบเวกเตอร์ (ซูมได้ไม่แตก) ทั้งแผนผังในหน้าเดียว

ใช้: dxf_to_pdf.py in.dxf out.pdf
"""
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")

import ezdxf
from ezdxf import bbox
from ezdxf.fonts import fonts as ezfonts
from ezdxf.addons.drawing import Frontend, RenderContext, layout, pymupdf
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration

# ความยาวด้านยาวของหน้า PDF (มม.) ~ A1 เพื่อให้ตัวหนังสือไม่เล็กเกินไปตอนเปิดบนมือถือ/tablet
LONG_SIDE_MM = 841.0
MAX_ASPECT = 6.0  # กันผังแคบยาวผิดปกติ


_INT = re.compile(rb"^\s*-?\d+\s*$")


def sanitize_dxf(src: str, dst: str) -> int:
    """ซ่อมไฟล์ DXF ที่ LibreDWG สร้าง: ข้อความที่มีการขึ้นบรรทัดใหม่ดิบๆ อยู่ในค่า
    ทำให้โครงสร้าง (บรรทัดคู่ รหัส/ค่า) เพี้ยนแล้ว ezdxf อ่านไม่ได้
    → ต่อบรรทัดที่ไม่ใช่ "รหัสกลุ่ม" กลับเข้ากับค่าก่อนหน้า (คืนจำนวนบรรทัดที่ซ่อม)
    """
    with open(src, "rb") as f:
        lines = f.read().split(b"\n")
    out: list[bytes] = []
    fixed = 0
    i = 0
    n = len(lines)
    while i < n:
        code = lines[i]
        if not code.strip() and i == n - 1:
            break
        if _INT.match(code) and i + 1 < n:
            out.append(code)
            out.append(lines[i + 1])
            i += 2
            # ถ้าบรรทัดถัดไปไม่ใช่รหัสกลุ่ม แสดงว่าเป็นส่วนที่เหลือของค่าเดิม (ขึ้นบรรทัดใหม่กลางข้อความ)
            while i < n and lines[i].strip() and not _INT.match(lines[i]):
                out[-1] = out[-1].rstrip(b"\r") + b" " + lines[i].rstrip(b"\r")
                fixed += 1
                i += 1
        else:
            # บรรทัดเศษที่ไม่ต่อกับอะไร → ข้าม
            fixed += 1
            i += 1
    with open(dst, "wb") as f:
        f.write(b"\n".join(out) + b"\n")
    return fixed


def force_thai_font(doc) -> None:
    """ให้ตัวหนังสือไทยแสดงได้: ใช้ฟอนต์ไทยแทนฟอนต์เดิมของไฟล์ (ที่เครื่อง build ไม่มี)
    บน GitHub runner ติดตั้งด้วย: apt-get install fonts-thai-tlwg
    """
    font = os.environ.get("PDF_THAI_FONT", "Loma.ttf")
    for style in doc.styles:
        try:
            style.dxf.font = font
            style.dxf.bigfont = ""
        except Exception:
            pass


def main(src: str, dst: str) -> None:
    # recover: ยอมรับ DXF ที่ได้จากการแปลงแล้วมีส่วนที่ไม่สมบูรณ์เล็กน้อย
    fixed_path = src + ".fixed.dxf"
    n_fixed = sanitize_dxf(src, fixed_path)
    if n_fixed:
        print(f"ซ่อมโครงสร้าง DXF {n_fixed} จุด (ข้อความที่มีการขึ้นบรรทัดใหม่)")
    try:
        doc = ezdxf.readfile(fixed_path)
    except Exception as e:
        print(f"อ่านแบบปกติไม่ได้ ({type(e).__name__}) → ใช้โหมดกู้ไฟล์")
        from ezdxf import recover

        doc, _auditor = recover.readfile(fixed_path)

    ezfonts.build_system_font_cache()  # สแกนฟอนต์ที่เพิ่งติดตั้งใหม่
    force_thai_font(doc)
    msp = doc.modelspace()
    ext = bbox.extents(msp, fast=True)
    if not ext.has_data:
        raise SystemExit("ไม่พบเส้น/วัตถุในผังหลัก (Model space ว่าง)")

    w = max(ext.size.x, 1e-6)
    h = max(ext.size.y, 1e-6)
    aspect = min(max(w / h, 1 / MAX_ASPECT), MAX_ASPECT)
    if aspect >= 1:
        page_w, page_h = LONG_SIDE_MM, LONG_SIDE_MM / aspect
    else:
        page_w, page_h = LONG_SIDE_MM * aspect, LONG_SIDE_MM

    cfg = Configuration(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.COLOR,
        # เส้นบางสุด ~0.1 มม. กันเส้นหายตอนซูมออก
        min_lineweight=0.1,
    )
    ctx = RenderContext(doc)
    backend = pymupdf.PyMuPdfBackend()
    Frontend(ctx, backend, config=cfg).draw_layout(msp, finalize=True)

    page = layout.Page(page_w, page_h, layout.Units.mm, margins=layout.Margins.all(5))
    pdf = backend.get_pdf_bytes(page, settings=layout.Settings(fit_page=True))
    with open(dst, "wb") as f:
        f.write(pdf)
    print(f"PDF ok: {dst} ({len(pdf)/1048576:.1f} MB, page {page_w:.0f}x{page_h:.0f} mm)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
