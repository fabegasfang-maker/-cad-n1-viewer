#!/usr/bin/env python3
"""วินิจฉัยความหนาเส้น/สัญลักษณ์: เรนเดอร์ภาพบริเวณหนึ่งของผัง (ซูมสูงสุดเท่าตัวแผนที่จริง)
ด้วยค่าตั้งหลายแบบ แล้วพิมพ์สถิติของวัตถุในบริเวณนั้น

ใช้: diag.py in.dxf out_dir [คำค้นสำหรับหาจุดกึ่งกลาง ค่าเริ่มต้น "TP1"]
env: DIAG_NEAR (ข้อความอ้างอิง ใกล้ ๆ กับคำค้น เช่น "เชียงใหม่ 4"), DIAG_W/DIAG_H (หน่วยของผัง)
"""
import dataclasses
import os
import sys
import warnings
from collections import Counter

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ezdxf
import pymupdf as mu
from ezdxf import bbox
from ezdxf.addons.drawing import Frontend, RenderContext, layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration, TextPolicy
from ezdxf.math import BoundingBox2d

import importlib.util
import pathlib
import urllib.request

# ตัวแปลงจริงอยู่ใน _dxf_to_pdf_real.py (dxf_to_pdf.py เป็นตัวดึงมาจาก commit ที่ระบุ) หรือเป็นสคริปต์เต็มเอง
_here = pathlib.Path(__file__).parent
_real = _here / "_dxf_to_pdf_real.py"
_stub = _here / "dxf_to_pdf.py"
_txt = _stub.read_text(encoding="utf-8")
if "runpy" in _txt and not _real.exists():
    import re as _re

    _url = _re.search(r'URL = "([^"]+)"', _txt).group(1)
    _real.write_bytes(urllib.request.urlopen(_url, timeout=60).read())
_target = _real if "runpy" in _txt else _stub
_spec = importlib.util.spec_from_file_location("D", str(_target))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)  # ใช้ขั้นตอนอ่าน/ซ่อม DXF เดียวกับตัวสร้างจริง

KNOWN = {
    "LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "HATCH", "SOLID", "TRACE",
    "3DFACE", "POINT", "INSERT", "MTEXT", "TEXT", "ATTRIB", "ATTDEF", "DIMENSION", "LEADER", "MLEADER",
    "MESH", "IMAGE", "XLINE", "RAY", "MLINE", "VIEWPORT", "WIPEOUT", "SEQEND", "VERTEX",
}


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


def summarize(ents, doc, title):
    print(f"\n===== {title}: {len(ents)} วัตถุ =====")
    print("ชนิด:", dict(Counter(e.dxftype() for e in ents).most_common()))
    lw = Counter()
    for e in ents:
        v = e.dxf.get("lineweight", -1)
        if v in (-1, None):  # BYLAYER
            try:
                v = f"layer:{doc.layers.get(e.dxf.layer).dxf.lineweight}"
            except Exception:
                v = "layer:?"
        lw[v] += 1
    print("ความหนาเส้น (1/100 มม.):", dict(lw.most_common(12)))
    widths = Counter()
    for e in ents:
        if e.dxftype() == "LWPOLYLINE":
            cw = e.dxf.get("const_width", 0)
            pts = e.get_points("seb")
            w = max([cw] + [max(a, b) for a, b, _ in pts])
            widths[round(w, 2)] += 1
    if widths:
        print("LWPOLYLINE ความกว้าง (หน่วยผัง):", dict(widths.most_common(10)))
    print("linetype:", dict(Counter(e.dxf.get("linetype", "BYLAYER") for e in ents).most_common(8)))
    print("ltscale ต่อวัตถุ:", dict(Counter(round(e.dxf.get("ltscale", 1.0), 3) for e in ents).most_common(6)))
    print("สี (ACI/true):", dict(Counter((e.dxf.get("color", 256), e.dxf.get("true_color")) for e in ents).most_common(10)))
    print("layer:", dict(Counter(e.dxf.layer for e in ents).most_common(12)))
    inserts = Counter(e.dxf.name for e in ents if e.dxftype() == "INSERT")
    for name, n in inserts.most_common(8):
        try:
            blk = doc.blocks.get(name)
        except Exception:
            continue
        kinds = Counter(x.dxftype() for x in blk)
        lws = Counter(x.dxf.get("lineweight", -1) for x in blk)
        ws = Counter(
            round(max([x.dxf.get("const_width", 0)] + [max(a, b) for a, b, _ in x.get_points("seb")]), 2)
            for x in blk if x.dxftype() == "LWPOLYLINE"
        )
        print(f"  บล็อก {name} x{n}: {dict(kinds)} lw={dict(lws)} widths={dict(ws)}")


def render(doc, sel, cfg, win, mm_per_unit, out_png):
    x0, y0, x1, y1 = win
    ctx = RenderContext(doc)
    backend = ezpdf.PyMuPdfBackend()
    fe = Frontend(ctx, backend, config=cfg)
    fe.draw_entities(sel)
    backend.finalize()
    page = layout.Page((x1 - x0) * mm_per_unit, (y1 - y0) * mm_per_unit, layout.Units.mm, margins=layout.Margins.all(0))
    settings = layout.Settings(fit_page=True)
    box = BoundingBox2d([(x0, y0), (x1, y1)])
    replay = backend.get_replay(page, settings=settings, render_box=box)
    pdf = replay.get_pdf_bytes()
    d = mu.open(stream=pdf, filetype="pdf")
    pix = d[0].get_pixmap(matrix=mu.Matrix(12.15, 12.15), alpha=False)  # เท่าซูมสูงสุดของแผนที่
    pix.save(out_png)
    print(f"  → {out_png} ({pix.width}x{pix.height})")


def cfg_of(**kw):
    base = dict(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.COLOR,
        text_policy=TextPolicy.FILLING,
        min_lineweight=0.05,
    )
    base.update(kw)
    return Configuration(**base)


def raw_scan(path, keys):
    """ค้นสตริงในไฟล์ DXF ดิบ (ก่อน ezdxf) บอกว่าอยู่ในส่วนไหน/บล็อกไหน/วัตถุชนิดใด"""
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    print(f"[raw] DXF {len(lines)} บรรทัด")
    sec = blk = etype = None
    hits = {k: [] for k in keys}
    ent_count = Counter()
    i = 0
    while i + 1 < len(lines):
        code, val = lines[i].strip(), lines[i + 1].rstrip("\r")
        if code == "0":
            if val == "SECTION":
                pass
            elif val == "ENDSEC":
                sec = None
            elif val == "BLOCK":
                etype = "BLOCK"
            else:
                etype = val
                if sec == "ENTITIES":
                    ent_count[val] += 1
        elif code == "2" and etype is None and lines[i - 2].strip() == "0" and lines[i - 1].strip() == "SECTION":
            sec = val
        elif code == "2" and etype == "BLOCK":
            blk = val
        elif code == "2" and lines[i - 1].strip() == "SECTION":
            sec = val
        for k in keys:
            if k in val and code in ("1", "3"):
                hits[k].append((i, sec, blk if sec == "BLOCKS" else None, etype))
        i += 2
    for k, v in hits.items():
        print(f"[raw] '{k}': {len(v)} จุด", v[:6])
    print("[raw] ชนิดวัตถุใน ENTITIES:", dict(ent_count.most_common(12)))


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    raw_scan(src, os.environ.get("DIAG_RAW", "CMD04VS-116,CMD04VS-117,CMD09VS-103,R3,Compact Unit,RMU 1,RMU 2,50kVA").split(","))
    fixed = src + ".fixed.dxf"
    D.sanitize_dxf(src, fixed)
    try:
        doc = ezdxf.readfile(fixed)
    except Exception:
        from ezdxf import recover

        doc, _ = recover.readfile(fixed)
    D.ezfonts.build_system_font_cache()
    D.force_thai_font(doc)
    for layer in doc.layers:
        try:
            layer.on()
            layer.thaw()
        except Exception:
            pass
    msp = doc.modelspace()
    print("ezdxf", ezdxf.__version__, "| Configuration:", [f.name for f in dataclasses.fields(Configuration)])
    print("DXF $LWDISPLAY/$PDMODE/$PDSIZE:", doc.header.get("$LWDISPLAY"), doc.header.get("$PDMODE"), doc.header.get("$PDSIZE"))
    print("linetypes:", [lt.dxf.name for lt in doc.linetypes][:30])
    print("header LTSCALE/MSLTSCALE/CELTSCALE:", doc.header.get("$LTSCALE"), doc.header.get("$MSLTSCALE"), doc.header.get("$CELTSCALE"))
    for lt in doc.linetypes:
        try:
            print("  pattern", lt.dxf.name, list(lt.pattern_tags.tags)[:0] or lt.dxf.get("description"), lt.pattern_tags.get_style_handle() if False else "")
        except Exception:
            pass
    print("layers:", [(l.dxf.name, l.dxf.get("lineweight"), l.dxf.get("linetype")) for l in doc.layers])

    # ชนิดวัตถุที่ ezdxf วาดไม่ได้ (อาจเป็นสาเหตุเส้น/สัญลักษณ์หาย) ทั้ง Model space และบล็อก
    unk = Counter(e.dxftype() for e in msp if e.dxftype() not in KNOWN)
    unk_b = Counter(e.dxftype() for b in doc.blocks for e in b if e.dxftype() not in KNOWN)
    print("วัตถุชนิดที่ไม่รู้จัก ใน Model:", dict(unk), "| ในบล็อก:", dict(unk_b))
    lt = Counter(e.dxf.get("linetype", "BYLAYER") for e in msp)
    print("linetype ใน Model:", dict(lt.most_common(10)))

    full = bbox.extents(msp, fast=True)
    mm_per_unit = (1189 - 10) / max(full.size.x, 1e-6)
    print(f"มาตราส่วนหน้า A0: {mm_per_unit:.5f} มม./หน่วย")

    # หาจุดกึ่งกลาง: ข้อความที่มีคำค้น ที่อยู่ใกล้ข้อความอ้างอิง (ถ้ามี)
    key = os.environ.get("DIAG_KEY", "TP1")
    near_txt = os.environ.get("DIAG_NEAR", "เชียงใหม่ 4")
    hits = [(plain(e), pos(e)) for e in msp if e.dxftype() in ("TEXT", "MTEXT") and pos(e)]
    cand = [p for t, p in hits if key in t]
    ref = [p for t, p in hits if near_txt in t.replace("\n", " ")]
    # ตรวจว่าข้อความ/วัตถุบริเวณที่หายยังอยู่ในไฟล์ DXF ที่แปลงมาหรือไม่
    for probe in os.environ.get("DIAG_PROBE", "CMD04VS-116,CMD04VS-120,CMD09VS-106,Compact,RMU,50kVA,Spare").split(","):
        found = [(round(p[0]), round(p[1])) for t, p in hits if probe in t.replace("\n", " ")]
        print(f"probe '{probe}': {len(found)} จุด", found[:5])
    inv = sum(1 for e in msp if e.dxf.get("invisible", 0))
    print("วัตถุที่ตั้ง invisible ใน Model:", inv)
    print(f"พบข้อความ '{key}' {len(cand)} จุด, '{near_txt}' {len(ref)} จุด")
    if not cand:
        raise SystemExit("ไม่พบข้อความอ้างอิง")
    if ref:
        r = ref[0]
        c = min(cand, key=lambda p: (p[0] - r[0]) ** 2 + (p[1] - r[1]) ** 2)
    else:
        c = cand[0]
    W = float(os.environ.get("DIAG_W", "560"))
    H = float(os.environ.get("DIAG_H", "350"))
    win = (c[0] - W * 0.55, c[1] - H * 0.55, c[0] + W * 0.45, c[1] + H * 0.45)
    print("กึ่งกลาง", c, "หน้าต่าง", [round(v) for v in win])

    wbox = BoundingBox2d([(win[0], win[1]), (win[2], win[3])])
    sel = []
    for e in msp:
        try:
            b = bbox.extents([e], fast=True)
            if b.has_data and wbox.has_intersection(BoundingBox2d([(b.extmin.x, b.extmin.y), (b.extmax.x, b.extmax.y)])):
                sel.append(e)
        except Exception:
            pass
    summarize(sel, doc, "วัตถุในหน้าต่าง")
    print("invisible ในหน้าต่าง:", sum(1 for e in sel if e.dxf.get("invisible", 0)))
    print("เลเยอร์ในหน้าต่าง:", dict(Counter(e.dxf.layer for e in sel).most_common(12)))
    cols = Counter()
    for e in sel:
        if e.dxf.hasattr("true_color"):
            cols[f"rgb{tuple(ezdxf.colors.int2rgb(e.dxf.true_color))}"] += 1
        else:
            cols[f"aci{e.dxf.get('color', 256)}"] += 1
    print("สีในหน้าต่าง:", dict(cols.most_common(12)))
    print("INSERT ในหน้าต่าง:", dict(Counter(e.dxf.name for e in sel if e.dxftype() == "INSERT").most_common(25)))

    variants = [
        ("A_current", cfg_of()),
        ("B_hairline", cfg_of(lineweight_scaling=0.0)),
        ("C_hair0.10", cfg_of(lineweight_scaling=0.0, min_lineweight=0.10)),
        ("D_scale0.25", cfg_of(lineweight_scaling=0.25)),
    ]
    try:
        from ezdxf.addons.drawing.config import LineweightPolicy

        variants.append(("E_relative", cfg_of(lineweight_policy=LineweightPolicy.RELATIVE)))
    except Exception as ex:
        print("ไม่มี LineweightPolicy:", ex)
    try:
        from ezdxf.addons.drawing.config import LinePolicy

        variants += [
            ("L_hair_solid", cfg_of(lineweight_scaling=0.0, line_policy=LinePolicy.SOLID)),
            ("M_hair_approx", cfg_of(lineweight_scaling=0.0, line_policy=LinePolicy.APPROXIMATE)),
            ("N_hair_accurate", cfg_of(lineweight_scaling=0.0, line_policy=LinePolicy.ACCURATE)),
        ]
    except Exception as ex:
        print("ไม่มี LinePolicy:", ex)
    for name, cfg in variants:
        print("เรนเดอร์", name)
        try:
            render(doc, sel, cfg, win, mm_per_unit, os.path.join(out_dir, f"{name}.png"))
        except Exception as ex:
            print("  ผิดพลาด:", type(ex).__name__, ex)

    # ค่าที่ pipeline จริงใช้อยู่ตอนนี้ (ลด lineweight ที่หนาเกิน + build_draw_config)
    if hasattr(D, "build_draw_config"):
        try:
            import copy as _copy

            n = D.thin_entity_lineweights(doc) if hasattr(D, "thin_entity_lineweights") else 0
            print(f"H_pipeline_now: ลด lineweight {n} จุด; config =", D.build_draw_config())
            c = D.build_draw_config()
            try:
                c = dataclasses.replace(c, text_policy=TextPolicy.FILLING)
            except Exception:
                pass
            render(doc, sel, c, win, mm_per_unit, os.path.join(out_dir, "H_pipeline_now.png"))
        except Exception as ex:
            print("  H ผิดพลาด:", type(ex).__name__, ex)

    # ทดสอบสมมติฐาน: ความกว้าง LWPOLYLINE เป็นต้นเหตุของก้อนอ้วน → ตั้งเป็น 0 ทั้งผัง
    n0 = 0
    for container in [msp] + [b for b in doc.blocks]:
        for e in container:
            if e.dxftype() == "LWPOLYLINE":
                try:
                    pts = [(x, y, 0, 0, b) for x, y, _, _, b in e.get_points("xyseb")]
                    e.set_points(pts, format="xyseb")
                    e.dxf.const_width = 0
                    n0 += 1
                except Exception:
                    pass
    print(f"ตั้งความกว้าง LWPOLYLINE = 0 จำนวน {n0} เส้น")
    for name, cfg in [("F_nowidth", cfg_of()), ("G_nowidth_hair", cfg_of(lineweight_scaling=0.0))]:
        print("เรนเดอร์", name)
        try:
            render(doc, sel, cfg, win, mm_per_unit, os.path.join(out_dir, f"{name}.png"))
        except Exception as ex:
            print("  ผิดพลาด:", type(ex).__name__, ex)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
