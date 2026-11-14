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
    if os.environ.get("DIAG_LIST") and "list_done" not in render.__dict__:
        render.list_done = True
        for e in msp:
            if e.dxf.handle in keep:
                extra = e.dxf.name if e.dxftype() == "INSERT" else ""
                print("   ·", e.dxftype(), "layer=", e.dxf.layer, "color=", e.dxf.get("color", 256), "tc=", e.dxf.get("true_color"), extra)
                if e.dxftype() == "INSERT":
                    try:
                        for x in doc.blocks.get(e.dxf.name):
                            print("        └", x.dxftype(), "layer=", x.dxf.layer, "color=", x.dxf.get("color", 256),
                                  "tc=", x.dxf.get("true_color"), "solid=" + str(getattr(x.dxf, "solid_fill", "")) if x.dxftype() == "HATCH" else "")
                    except Exception:
                        pass
    backend = ezpdf.PyMuPdfBackend()
    ents = [e for e in msp if e.dxf.handle in keep]
    if os.environ.get("PDF_HATCH_BOTTOM", "1") != "0":  # เหมือน pipeline: HATCH/SOLID/TRACE ไว้ล่างสุด
        bg = {"HATCH", "SOLID", "TRACE"}
        ents = [e for e in ents if e.dxftype() in bg] + [e for e in ents if e.dxftype() not in bg]
    import dataclasses
    from ezdxf.addons.drawing.config import BackgroundPolicy
    cfg = D.build_draw_config()
    print("   config:", cfg.background_policy, cfg.color_policy, cfg.lineweight_scaling, cfg.min_lineweight)
    cfg = dataclasses.replace(cfg, background_policy=BackgroundPolicy.OFF)
    fe = Frontend(RenderContext(doc), backend, config=cfg)
    backend.set_background("#FFFFFFFF")  # draw_entities ไม่ตั้งพื้นหลังเอง (draw_layout ตั้งให้) → ตั้งขาวเอง
    fe.draw_entities(ents)
    backend.finalize()
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
        (os.environ.get("DIAG_KEY", "CMD03VS-105"), os.environ.get("DIAG_NEAR", "ต้นพยอม"), float(os.environ.get("DIAG_W", "130")), float(os.environ.get("DIAG_H", "80")), "sw"),
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
        if name == VARIANTS[0][0]:
            print("$FILLMODE =", doc.header.get("$FILLMODE"))
            for bn in ("SF6OL", "SF6CL"):
                try:
                    for x in doc.blocks.get(bn):
                        if x.dxftype() == "LWPOLYLINE":
                            print(f"  {bn} LWPOLYLINE closed={x.closed} const_width={x.dxf.get('const_width')} "
                                  f"pts={list(x.get_points('xyseb'))[:6]} lw={x.dxf.get('lineweight')} layer={x.dxf.layer}")
                        elif x.dxftype() != "LINE":
                            print(f"  {bn} {x.dxftype()}")
                except Exception as ex:
                    print("  block", bn, ex)
        D.prepare_entities_for_white_bg(doc, msp)
        for c, W, H, tag in centers:
            win = (c[0] - W * 0.5, c[1] - H * 0.5, c[0] + W * 0.5, c[1] + H * 0.5)
            n = render(doc, win, mm, os.path.join(out_dir, f"{tag}_{name}.png"))
            print(f"  {name} {tag}: {n} objects in window")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
