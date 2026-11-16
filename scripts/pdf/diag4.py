#!/usr/bin/env python3
"""ทดสอบการขยายตัวอักษรเล็ก (เฉพาะชั้นข้อความ ไม่เรนเดอร์เส้น) เทียบ 3 โหมดบนไฟล์จริง

โหมด: A เดิม(ไม่ขยาย) / B ขยายตายตัวถึงขั้นต่ำ / C ขยายตามที่ว่าง   ผล: สถิติ + ภาพตัดรอบข้อความอ้างอิง
ใช้: diag4.py in.dxf out_dir   (env: DIAG_KEYS = ข้อความอ้างอิงคั่นด้วย |)
หมายเหตุ: ไม่ผ่าน prepare_entities_for_white_bg จึงกรอบหน้าอาจต่างจากรอบจริงเล็กน้อย แต่ขนาดสัมพัทธ์ของข้อความเหมือนเดิม
"""
import copy
import importlib.util
import os
import pathlib
import sys
import time
import warnings

warnings.filterwarnings("ignore")
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("D", str(HERE / "dxf_to_pdf.py"))
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

import pymupdf as mu
from ezdxf.addons.drawing import layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.math import BoundingBox2d, Vec2
from ezdxf.fonts import fonts as ezfonts


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    doc = D.load_dxf_document(src)
    ezfonts.build_system_font_cache()
    D.force_thai_font(doc)
    D.normalize_layers(doc)
    msp = doc.modelspace()
    ext = D.safe_modelspace_extents(msp)
    w, h = max(ext.size.x, 1e-6), max(ext.size.y, 1e-6)
    aspect = min(max(w / h, 1 / D.MAX_ASPECT), D.MAX_ASPECT)
    page_w, page_h = (D.LONG_SIDE_MM, D.LONG_SIDE_MM / aspect) if aspect >= 1 else (D.LONG_SIDE_MM * aspect, D.LONG_SIDE_MM)
    page_def = layout.Page(page_w, page_h, layout.Units.mm, margins=layout.Margins.all(5))
    st = layout.Settings(fit_page=True)
    rb = BoundingBox2d([(ext.extmin.x, ext.extmin.y), (ext.extmax.x, ext.extmax.y)])
    lay = layout.Layout(rb, flip_y=True)
    fp = lay.get_final_page(page_def, st)
    st2 = copy.copy(st)
    st2.output_coordinate_space = ezpdf.get_coordinate_output_space(fp)
    m = lay.get_placement_matrix(fp, settings=st2, top_origin=True)
    texts = D.collect_texts(doc, msp)
    pw, ph = page_w / 25.4 * 72, page_h / 25.4 * 72
    print(f"โหลด+เตรียม {time.time()-t0:.0f}s  ข้อความ {len(texts)} ชิ้น  หน้า {pw:.0f}x{ph:.0f} pt")
    maxw = float(os.environ.get("TILE_MAX_WIDTH_PX", "131072"))
    pxpt = maxw / pw  # พิกเซลต่อ pt ที่ซูมสูงสุด
    print(f"ซูมสูงสุด = {pxpt:.1f} px/pt")

    keys = [k for k in os.environ.get("DIAG_KEYS", "Compact Substation No.6|Compact Substation No.5|CMH04VS-134").split("|") if k]
    modes = (("A", False, 0), ("B", False, 12), ("C", True, 12))
    results = {}
    for tag, fit, minpx in modes:
        os.environ["PDF_MIN_TEXT_PX"] = str(minpx)
        pdf = mu.open()
        pg = pdf.new_page(width=pw, height=ph)
        idx = []
        t1 = time.time()
        D.place_texts(pg, m, texts, D.find_thai_font(), idx, fit=fit)
        print(f"[{tag}] place_texts {time.time()-t1:.1f}s")
        results[tag] = (pg, idx)
        if tag in ("A", "C"):
            sizes = sorted(fs * pxpt for _t, _x, _y, fs in idx)
            n = len(sizes)
            pct = lambda v: 100.0 * sum(1 for s_ in sizes if s_ < v) / max(n, 1)
            print(f"   [{tag}] ขนาด em ที่ซูมสูงสุด (px): p5={sizes[n//20]:.1f} p10={sizes[n//10]:.1f} p25={sizes[n//4]:.1f} median={sizes[n//2]:.1f}; "
                  f"สัดส่วนที่ < 6px={pct(6):.1f}%  < 9px={pct(9):.1f}%  < 12px={pct(12):.1f}%")

    # ภาพตัดรอบข้อความอ้างอิง (ขนาดเท่าซูมสูงสุด 1:2)
    zoom = pxpt * 0.5
    for key in keys:
        hits = [(t, x, y) for t, x, y, fs in results["A"][1] if key in t]
        if not hits:
            print("ไม่พบข้อความ", key)
            continue
        _t, x, y = hits[0]
        print(f"อ้างอิง {key!r} ที่ x={x:.1f} y={y:.1f} (pt) พบ {len(hits)} ที่")
        win = mu.Rect(x - 45, y - 45, x + 45, y + 35)
        for tag in ("A", "B", "C"):
            pix = results[tag][0].get_pixmap(matrix=mu.Matrix(zoom, zoom), clip=win, alpha=False)
            name = f"{tag}_{''.join(ch for ch in key if ch.isalnum())[:24]}.png"
            pix.save(os.path.join(out_dir, name))
        print(f"   → ภาพ {pix.width}x{pix.height}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
