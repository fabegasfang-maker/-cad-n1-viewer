#!/usr/bin/env python3
"""วินิจฉัย "เส้นหาย": เรนเดอร์ภาพบริเวณหนึ่งของผังตามขั้นตอนจริงของ dxf_to_pdf.py
เทียบกับแบบไม่ผ่านขั้นตอนปรับแต่ง (prepare_entities_for_white_bg) และค่าความหนาอื่น ๆ
พร้อมนับวัตถุในบริเวณนั้นก่อน/หลังปรับแต่ง เพื่อดูว่าชนิดไหนถูกลบ

ใช้: diag.py in.dxf out_dir
env: DIAG_KEY (ข้อความหาจุดกึ่งกลาง), DIAG_NEAR (ข้อความใกล้ ๆ, ถ้ามี), DIAG_W/DIAG_H (หน่วยของผัง)
"""
import importlib.util
import os
import sys
import warnings
from collections import Counter

warnings.filterwarnings("ignore")

import ezdxf
import pymupdf as mu
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.addons.drawing.config import Configuration, TextPolicy
from ezdxf.math import BoundingBox2d

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("D", os.path.join(_here, "dxf_to_pdf.py"))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)  # ฟังก์ชันชุดเดียวกับ pipeline จริง


def plain(e):
    try:
        if e.dxftype() == "MTEXT":
            return e.plain_text()
        if e.dxftype() in ("TEXT", "ATTRIB"):
            return e.dxf.text
    except Exception:
        pass
    return ""


def pos(e):
    try:
        v = e.dxf.insert
        return v.x, v.y
    except Exception:
        return None


def in_window(msp, win):
    wbox = BoundingBox2d([(win[0], win[1]), (win[2], win[3])])
    sel = []
    for e in msp:
        try:
            b = bbox.extents([e], fast=True)
            if b.has_data and wbox.has_intersection(
                BoundingBox2d([(b.extmin.x, b.extmin.y), (b.extmax.x, b.extmax.y)])
            ):
                sel.append(e)
        except Exception:
            pass
    return sel


def describe(label, ents):
    print(f"\n== {label}: {len(ents)} วัตถุ ==")
    print(" ชนิด:", dict(Counter(e.dxftype() for e in ents).most_common()))
    print(" linetype:", dict(Counter(e.dxf.get("linetype", "BYLAYER") for e in ents).most_common(6)))
    print(" สี(ACI,true):", dict(Counter((e.dxf.get("color", 256), e.dxf.get("true_color")) for e in ents).most_common(8)))
    print(" layer:", dict(Counter(e.dxf.layer for e in ents).most_common(10)))
    w = Counter()
    for e in ents:
        if e.dxftype() == "LWPOLYLINE":
            try:
                w[round(max([e.dxf.get("const_width", 0)] + [max(a, b) for a, b, _ in e.get_points("seb")]), 2)] += 1
            except Exception:
                pass
    if w:
        print(" LWPOLYLINE width:", dict(w.most_common(8)))
    ins = Counter(e.dxf.name for e in ents if e.dxftype() == "INSERT")
    print(" INSERT:", dict(ins.most_common(15)))


def render(doc, sel, cfg, win, mm_per_unit, out_png):
    x0, y0, x1, y1 = win
    backend = ezpdf.PyMuPdfBackend()
    fe = Frontend(RenderContext(doc), backend, config=cfg)
    # ใช้ draw_layout (ลงพื้นขาว/สีเส้นตามพื้นขาว/ลำดับวาดตาม SORTENTS เหมือน pipeline จริง) แต่กรองเฉพาะวัตถุในหน้าต่าง
    keep = {e.dxf.handle for e in sel}
    fe.draw_layout(doc.modelspace(), finalize=True, filter_func=lambda e: e.dxf.handle in keep)
    page = layout.Page((x1 - x0) * mm_per_unit, (y1 - y0) * mm_per_unit, layout.Units.mm, margins=layout.Margins.all(0))
    box = BoundingBox2d([(x0, y0), (x1, y1)])
    replay = backend.get_replay(page, settings=layout.Settings(fit_page=True), render_box=box)
    d = mu.open(stream=replay.get_pdf_bytes(), filetype="pdf")
    pix = d[0].get_pixmap(matrix=mu.Matrix(14, 14), alpha=True)
    from PIL import Image as _I

    im = _I.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    bg = _I.new("RGBA", im.size, "white")  # พื้นโปร่งใส → ลงพื้นขาวให้เหมือนแผนที่จริง
    bg.alpha_composite(im)
    bg.convert("RGB").save(out_png)
    print(f"  → {os.path.basename(out_png)} ({pix.width}x{pix.height})")


def cfg_with(**kw):
    c = D.build_draw_config()
    import dataclasses

    return dataclasses.replace(c, **kw)


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ezdxf_fonts = D.ezfonts
    ezdxf_fonts.build_system_font_cache()

    raw = D.load_dxf_document(src)
    D.force_thai_font(raw)
    D.normalize_layers(raw)
    msp = raw.modelspace()
    print("ezdxf", ezdxf.__version__)
    print("linetypes:", [lt.dxf.name for lt in raw.linetypes])
    print("header LTSCALE:", raw.header.get("$LTSCALE"), "MSLTSCALE:", raw.header.get("$MSLTSCALE"))
    print("pipeline config:", D.build_draw_config())
    full = bbox.extents(msp, fast=True)
    mm_per_unit = (1189 - 10) / max(full.size.x, 1e-6)

    key = os.environ.get("DIAG_KEY", "CMD04VS-120")
    near = os.environ.get("DIAG_NEAR", "")
    hits = [(plain(e), pos(e)) for e in msp if e.dxftype() in ("TEXT", "MTEXT") and pos(e)]
    cand = [p for t, p in hits if key in t]
    if not cand:
        raise SystemExit(f"ไม่พบข้อความ {key}")
    ref = [p for t, p in hits if near and near in t.replace("\n", " ")]
    c = min(cand, key=lambda p: (p[0] - ref[0][0]) ** 2 + (p[1] - ref[0][1]) ** 2) if ref else cand[0]
    W = float(os.environ.get("DIAG_W", "1100"))
    H = float(os.environ.get("DIAG_H", "600"))
    win = (c[0] - W * 0.6, c[1] - H * 0.6, c[0] + W * 0.4, c[1] + H * 0.4)
    print("กึ่งกลาง", c, "หน้าต่าง", [round(v) for v in win])

    sel_raw = in_window(msp, win)
    describe("ก่อนปรับแต่ง (ตรงจาก DWG)", sel_raw)
    sel_raw_ids = {e.dxf.handle: e.dxftype() for e in sel_raw}

    # ภาพ: ไม่ผ่าน prepare (ดิบ) ด้วยค่า pipeline และด้วยความหนาแบบเส้นบาง
    render(raw, sel_raw, cfg_with(), win, mm_per_unit, os.path.join(out_dir, "R_raw_pipecfg.png"))
    render(raw, sel_raw, cfg_with(lineweight_scaling=0.0, min_lineweight=0.05), win, mm_per_unit,
           os.path.join(out_dir, "S_raw_hair.png"))

    # ผ่านขั้นตอนจริงของ pipeline
    D.prepare_entities_for_white_bg(raw, msp)
    n = D.thin_entity_lineweights(raw)
    print(f"thin_entity_lineweights: {n}")
    sel_prep = in_window(msp, win)
    describe("หลัง prepare_entities_for_white_bg", sel_prep)
    after = {e.dxf.handle for e in sel_prep}
    lost = Counter(t for h, t in sel_raw_ids.items() if h not in after)
    print("\n*** วัตถุที่หายไปหลัง prepare (ในหน้าต่าง) ตามชนิด:", dict(lost))
    render(raw, sel_prep, cfg_with(), win, mm_per_unit, os.path.join(out_dir, "P_pipeline.png"))
    render(raw, sel_prep, cfg_with(lineweight_scaling=0.0, min_lineweight=0.05), win, mm_per_unit,
           os.path.join(out_dir, "Q_pipeline_hair.png"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
