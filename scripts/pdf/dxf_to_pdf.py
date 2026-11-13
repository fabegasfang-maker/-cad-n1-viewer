#!/usr/bin/env python3
"""DXF -> PDF แบบเวกเตอร์ (ซูมได้ไม่แตก) ทั้งแผนผังในหน้าเดียว

ใช้: dxf_to_pdf.py in.dxf out.pdf
"""
import os
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
    try:
        doc = ezdxf.readfile(src)
    except Exception:
        doc, _auditor = ezdxf.recover.readfile(src)

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
