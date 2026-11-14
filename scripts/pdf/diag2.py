#!/usr/bin/env python3
"""เทียบตัวบัง (WIPEOUT/พื้นขาว) และลำดับวาด บนผังจริง ที่จุดสัญลักษณ์สวิตช์ซ้อนทับ

ใช้: diag2.py in.dxf out_dir   (env: DIAG_KEY, DIAG_NEAR, DIAG_W, DIAG_H)
แต่ละแบบโหลด DXF ใหม่ → prepare ตามโหมด → เรนเดอร์หน้าต่างเดียวกัน (ลงพื้นขาว 14 px/pt)
"""
import importlib.util
import os
import pathlib
import sys
import warnings
from collections import Counter

warnings.filterwarnings("ignore")
HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("D", str(HERE / "dxf_to_pdf.py"))
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)

import pymupdf as mu
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.math import BoundingBox2d
from PIL import Image

VARIANTS = [
    ("V0_now", {"PDF_MASKS": "delete", "PDF_HATCH_BOTTOM": "1"}),
    ("V1_keepmasks", {"PDF_MASKS": "keep", "PDF_HATCH_BOTTOM": "1"}),
    ("V2_keepmasks_origorder", {"PDF_MASKS": "keep", "PDF_HATCH_BOTTOM": "0"}),
    ("V3_small_origorder", {"PDF_MASKS": "small", "PDF_HATCH_BOTTOM": "0"}),
]


def txt(e):
    try:
        if e.dxftype() == "MTEXT":
            return e.plain_text()
        if e.dxftype() == "TEXT":
            return e.dxf.text
    except Exception:
        pass
    return ""


def render(doc, win, mm_per_unit, out_png):
    msp = doc.modelspace()
    wb = BoundingBox2d([(win[0], win[1]), (win[2], win[3])])
    keep = set()
    for e in msp:
        try:
            b = bbox.extents([e], fast=True)
            if b.has_data and wb.has_intersection(BoundingBox2d([(b.extmin.x, b.extmin.y), (b.extmax.x, b.extmax.y)])):
                keep.add(e.dxf.handle)
        except Exception:
            pass
    backend = ezpdf.PyMuPdfBackend()
    Frontend(RenderContext(doc), backend, config=D.build_draw_config()).draw_layout(
        msp, finalize=True, filter_func=lambda e: e.dxf.handle in keep
    )
    page = layout.Page((win[2] - win[0]) * mm_per_unit, (win[3] - win[1]) * mm_per_unit, layout.Units.mm,
                       margins=layout.Margins.all(0))
    rep = backend.get_replay(page, settings=layout.Settings(fit_page=True), render_box=wb)
    d = mu.open(stream=rep.get_pdf_bytes(), filetype="pdf")
    pix = d[0].get_pixmap(matrix=mu.Matrix(14, 14), alpha=True)
    im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    bg = Image.new("RGBA", im.size, "white")
    bg.alpha_composite(im)
    bg.convert("RGB").save(out_png)
    return len(keep)


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    D.ezfonts.build_system_font_cache()
    wins = [
        (os.environ.get("DIAG_KEY", "CMD03VS-105"), os.environ.get("DIAG_NEAR", "ต้นพยอม"), 130, 80, "sw"),
        ("CMD04VS-120", "", 700, 440, "wide"),
    ]
    centers = None
    mm = None
    for name, env in VARIANTS:
        os.environ.update(env)
        doc = D.load_dxf_document(src)
        D.force_thai_font(doc)
        D.normalize_layers(doc)
        msp = doc.modelspace()
        if centers is None:
            mm = (1189 - 10) / max(bbox.extents(msp, fast=True).size.x, 1e-6)
            hits = [(txt(e), e.dxf.insert) for e in msp if e.dxftype() in ("TEXT", "MTEXT")]
            print("WIPEOUT:", sum(1 for e in msp if e.dxftype() == "WIPEOUT"),
                  "| HATCH:", sum(1 for e in msp if e.dxftype() == "HATCH"),
                  "| SORTENTS order entries:", len(list(msp.get_redraw_order())) if hasattr(msp, "get_redraw_order") else "n/a")
            print("white masks (msp+blocks):",
                  sum(1 for b in doc.blocks for e in b if e.dxftype() in ("HATCH", "SOLID", "TRACE") and D._is_white_mask_fill(doc, e)),
                  "WIPEOUT in blocks:", sum(1 for b in doc.blocks for e in b if e.dxftype() == "WIPEOUT"))
            centers = []
            for key, near, W, H, tag in wins:
                cand = [p for t, p in hits if key in t]
                ref = [p for t, p in hits if near and near in t.replace("\n", " ")]
                if not cand:
                    continue
                c = min(cand, key=lambda p: (p[0] - ref[0][0]) ** 2 + (p[1] - ref[0][1]) ** 2) if ref else cand[0]
                centers.append((c, W, H, tag))
                print("window", tag, "center", (round(c[0]), round(c[1])))
        D.prepare_entities_for_white_bg(doc, msp)
        for c, W, H, tag in centers:
            win = (c[0] - W * 0.5, c[1] - H * 0.5, c[0] + W * 0.5, c[1] + H * 0.5)
            n = render(doc, win, mm, os.path.join(out_dir, f"{tag}_{name}.png"))
            print(f"  {name} {tag}: {n} objects in window")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
