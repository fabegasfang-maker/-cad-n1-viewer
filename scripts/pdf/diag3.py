#!/usr/bin/env python3
"""วินิจฉัยเส้นปะ (linetype) ของสาย 115 kV: dump ข้อมูล linetype/เลเยอร์ + เรนเดอร์ผ่าน pipeline จริงแล้วตัดภาพ

ใช้: diag3.py in.dxf out_dir   (env: DIAG_KEY ข้อความอ้างอิงตำแหน่ง, DIAG_LAYER ชื่อเลเยอร์ที่สงสัย)
"""
import importlib.util
import json
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


def lt_pattern(lt):
    try:
        return [round(float(v), 3) for v in lt.pattern_tags.compile()]
    except Exception as ex:
        return f"ERR {type(ex).__name__}: {ex}"


def dump(src):
    doc = D.load_dxf_document(src)
    print("== header ==")
    for k in ("$LTSCALE", "$CELTSCALE", "$PSLTSCALE", "$MSLTSCALE", "$INSUNITS", "$MEASUREMENT"):
        print(" ", k, "=", doc.header.get(k))
    print("== linetypes (ชื่อ | pattern) ==")
    for lt in doc.linetypes:
        print(f"  {lt.dxf.name!r:28} {lt_pattern(lt)}  desc={lt.dxf.get('description', '')!r}")
    msp = doc.modelspace()
    per_layer = Counter(e.dxf.layer for e in msp)
    print("== layers (ชื่อ | linetype | color | lw | on/frozen | #entities ใน msp) ==")
    for lyr in doc.layers:
        print(
            f"  {lyr.dxf.name!r:34} lt={lyr.dxf.get('linetype')!r:18} color={lyr.dxf.get('color')} "
            f"lw={lyr.dxf.get('lineweight')} on={lyr.is_on()} frozen={lyr.is_frozen()} n={per_layer.get(lyr.dxf.name, 0)}"
        )
    want = os.environ.get("DIAG_LAYER", "115KV.")
    ents = [e for e in msp if e.dxf.layer == want]
    print(f"== เอนทิตีบนเลเยอร์ {want!r}: {len(ents)} ==")
    print(" ชนิด:", dict(Counter(e.dxftype() for e in ents).most_common()))
    print(" linetype (ระดับเอนทิตี):", dict(Counter(e.dxf.get("linetype", "BYLAYER") for e in ents).most_common()))
    print(" ltscale:", dict(Counter(round(float(e.dxf.get("ltscale", 1.0)), 3) for e in ents).most_common(6)))
    print(" สี:", dict(Counter((e.dxf.get("color", 256), e.dxf.get("true_color")) for e in ents).most_common(6)))
    lw = Counter()
    for e in ents:
        if e.dxftype() == "LWPOLYLINE":
            try:
                lw[("plinegen", bool(e.dxf.get("flags", 0) & 128), "const_w", round(float(e.dxf.get("const_width", 0)), 2))] += 1
            except Exception:
                pass
    if lw:
        print(" LWPOLYLINE (plinegen, width):", dict(lw.most_common(6)))
    return doc


def crop(pdf_path, texts_path, out_dir):
    key = os.environ.get("DIAG_KEY", "CMD10VS-101")
    items = json.load(open(texts_path, encoding="utf-8"))
    hit = [i for i in items if key in i[0]]
    if not hit:
        print("ไม่พบข้อความ", key, "ในดัชนี")
        return
    t, x, y, fs = hit[0]
    print(f"ตำแหน่ง {t!r} ในหน้า PDF: x={x} y={y} fs={fs}")
    d = mu.open(pdf_path)
    pg = d[0]
    drs = pg.get_drawings()
    print(f"drawings ทั้งหน้า: {len(drs)}; มี dash pattern: {sum(1 for dr in drs if dr.get('dashes') not in (None, '[] 0'))}")
    # เส้นในหน้าต่างรอบข้อความ: สีชมพูที่มี dashes?
    win = mu.Rect(x - 60, y - 140, x + 300, y + 60)
    near = [dr for dr in drs if dr.get("rect") and dr["rect"].intersects(win)]
    cnt = Counter((tuple(round(c, 2) for c in (dr.get("color") or ())), dr.get("dashes"), round(dr.get("width") or 0, 3)) for dr in near)
    print("เส้นในหน้าต่าง (color, dashes, width):")
    for k, v in cnt.most_common(12):
        print("  ", v, k)
    for name, rect, z in (("crop_close", win, 14), ("crop_wide", mu.Rect(x - 150, y - 400, x + 1000, y + 150), 5)):
        pix = pg.get_pixmap(matrix=mu.Matrix(z, z), clip=rect, alpha=False)
        pix.save(os.path.join(out_dir, f"{name}.png"))
        print("  →", name, pix.width, "x", pix.height)


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    dump(src)
    pdf = os.path.join(out_dir, "pipeline.pdf")
    texts = os.path.join(out_dir, "texts.json")
    D.main(src, pdf, texts)  # pipeline จริงตัวเดียวกับที่สร้างผัง
    crop(pdf, texts, out_dir)
    try:
        os.remove(pdf)  # ไม่ push PDF ใหญ่ขึ้น branch
    except OSError:
        pass
    try:
        os.remove(texts)
    except OSError:
        pass


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
