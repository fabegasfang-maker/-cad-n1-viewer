#!/usr/bin/env python3
"""DXF -> PDF แบบเวกเตอร์ ทั้งแผนผังในหน้าเดียว (ขนาด A0) ใช้เป็นต้นทางสร้างกระเบื้องแผนที่

ใช้: dxf_to_pdf.py in.dxf out.pdf [texts.json]
"""
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")

import ezdxf
from ezdxf import bbox
from ezdxf.fonts import fonts as ezfonts
import math
import copy

import pymupdf as mu
from ezdxf import colors as ezcolors
from ezdxf.math import BoundingBox2d, Vec2
from ezdxf.addons.drawing import Frontend, RenderContext, layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration, TextPolicy

try:
    from ezdxf.addons.drawing.config import LineweightPolicy
except Exception:
    LineweightPolicy = None  # type: ignore

LONG_SIDE_MM = 1189.0
MAX_ASPECT = 6.0

_INT = re.compile(rb"^\s*-?\d+\s*$")


def sanitize_dxf(src: str, dst: str) -> int:
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
            while i < n and lines[i].strip() and not _INT.match(lines[i]):
                out[-1] = out[-1].rstrip(b"\r") + b" " + lines[i].rstrip(b"\r")
                fixed += 1
                i += 1
        else:
            fixed += 1
            i += 1
    with open(dst, "wb") as f:
        f.write(b"\n".join(out) + b"\n")
    return fixed


_UNI = re.compile(r"\\U\+([0-9A-Fa-f]{4})")
CAP_RATIO = 0.8
LINE_SPACING = 5.0 / 3.0


def clean_text(t: str) -> str:
    t = _UNI.sub(lambda m: chr(int(m.group(1), 16)), t or "")
    return (
        t.replace("%%d", "°")
        .replace("%%D", "°")
        .replace("%%c", "Ø")
        .replace("%%C", "Ø")
        .replace("%%p", "±")
        .replace("%%P", "±")
    )


def find_thai_font() -> str:
    cands = [os.environ.get("PDF_THAI_FONT_FILE", "")]
    for d in (
        "/usr/share/fonts/truetype/tlwg",
        "/usr/share/fonts/truetype/noto",
        "/usr/share/fonts/opentype/tlwg",
    ):
        for n in ("Loma.ttf", "Garuda.ttf", "NotoSansThai-Regular.ttf", "Loma.otf"):
            cands.append(os.path.join(d, n))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    raise SystemExit("ไม่พบฟอนต์ไทย (ติดตั้ง fonts-thai-tlwg-ttf)")


def blocks_with_text(doc) -> set:
    memo: dict = {}

    def has(name: str, stack: tuple = ()) -> bool:
        if name in memo:
            return memo[name]
        if name in stack or name not in doc.blocks:
            return False
        res = False
        for e in doc.blocks[name]:
            t = e.dxftype()
            if t in ("TEXT", "MTEXT") or (t == "INSERT" and has(e.dxf.name, stack + (name,))):
                res = True
                break
        memo[name] = res
        return res

    return {b.name for b in doc.blocks if has(b.name)}


def entity_rgb(doc, e, parent_aci: int):
    try:
        if e.dxf.hasattr("true_color"):
            r, g, b = ezcolors.int2rgb(e.dxf.true_color)
        else:
            aci = e.dxf.color if e.dxf.hasattr("color") else 256
            if aci == 0:
                aci = parent_aci
            if aci == 256:
                aci = doc.layers.get(e.dxf.layer).color if e.dxf.layer in doc.layers else 7
            aci = abs(aci)
            r, g, b = (0, 0, 0) if aci == 7 else ezcolors.aci2rgb(aci)
    except Exception:
        r, g, b = 0, 0, 0
    if 0.299 * r + 0.587 * g + 0.114 * b > 205:
        r = g = b = 0
    return (r / 255, g / 255, b / 255)


def collect_texts(doc, msp):
    texts = []
    with_text = blocks_with_text(doc)

    def emit(e, parent_aci):
        t = e.dxftype()
        try:
            if t == "MTEXT":
                raw = e.plain_text(split=False)
            else:
                raw = e.dxf.text
        except Exception:
            return
        raw = clean_text(raw).replace("\r", "")
        if not raw.strip():
            return
        texts.append((e, raw, entity_rgb(doc, e, parent_aci)))

    def walk(entities, parent_aci, depth):
        for e in entities:
            t = e.dxftype()
            if t in ("TEXT", "MTEXT"):
                emit(e, parent_aci)
            elif t == "INSERT":
                if e.dxf.name not in with_text and not len(e.attribs):
                    continue
                aci = e.dxf.color if e.dxf.hasattr("color") and e.dxf.color not in (0, 256) else parent_aci
                for a in e.attribs:
                    if not (a.dxf.hasattr("invisible") and a.dxf.invisible):
                        emit(a, aci)
                if depth < 4 and e.dxf.name in with_text:
                    try:
                        walk(list(e.virtual_entities()), aci, depth + 1)
                    except Exception:
                        pass

    walk(msp, 7, 0)
    return texts


def place_texts(page, m, texts, font_file, index=None) -> int:
    font = mu.Font(fontfile=font_file)
    writers: dict = {}
    o = m.transform(Vec2(0, 0))
    scale = max((m.transform(Vec2(1, 0)) - o).magnitude, 1e-12)
    n = 0
    for e, raw, rgb in texts:
        try:
            t = e.dxftype()
            if t == "MTEXT":
                h = float(e.dxf.get("char_height", 2.5))
                ins = e.dxf.insert
                if e.dxf.hasattr("text_direction"):
                    d = e.dxf.text_direction
                    ang = math.atan2(d.y, d.x)
                else:
                    ang = math.radians(e.dxf.get("rotation", 0.0))
                ap = int(e.dxf.get("attachment_point", 1))
                halign = {1: 0, 2: 1, 3: 2}[(ap - 1) % 3 + 1]
                vpos = (ap - 1) // 3
                spacing = float(e.dxf.get("line_spacing_factor", 1.0))
            else:
                h = float(e.dxf.get("height", 2.5))
                ang = math.radians(e.dxf.get("rotation", 0.0))
                ha, va = int(e.dxf.get("halign", 0)), int(e.dxf.get("valign", 0))
                ins = e.dxf.align_point if (ha or va) and e.dxf.hasattr("align_point") else e.dxf.insert
                halign = {0: 0, 1: 1, 2: 2, 4: 1}.get(ha, 0)
                vpos = {0: 3, 1: 2, 2: 1, 3: 0}.get(va, 3)
                spacing = 1.0
            if h <= 0:
                continue
            fs = h * scale / CAP_RATIO
            lines = raw.split("\n")
            lh = h * LINE_SPACING * spacing
            nl = len(lines)
            if t == "MTEXT":
                first = {0: -h, 1: -h + (nl - 1) * lh / 2 - 0.0, 2: -h + (nl - 1) * lh}[vpos]
                if vpos == 1:
                    first = (nl - 1) * lh / 2 - h / 2
            else:
                first = {3: 0.0, 2: -h / 2, 1: 0.0, 0: -h}[vpos]
            ca, sa = math.cos(ang), math.sin(ang)
            for i, line in enumerate(lines):
                if not line.strip():
                    continue
                wpt = font.text_length(line, fontsize=fs)
                wd = wpt / scale
                dx = {0: 0.0, 1: -wd / 2, 2: -wd}[halign]
                dy = first - i * lh
                ox = ins.x + dx * ca - dy * sa
                oy = ins.y + dx * sa + dy * ca
                p = m.transform(Vec2(ox, oy))
                dirv = m.transform(Vec2(ox + ca, oy + sa)) - p
                a_out = math.degrees(math.atan2(dirv.y, dirv.x))
                pt = mu.Point(p.x, p.y)
                if index is not None and len(line.strip()) >= 2:
                    index.append((line.strip(), p.x, p.y, fs))
                if abs(a_out) > 0.01:
                    tw1 = mu.TextWriter(page.rect)
                    tw1.append(pt, line, font=font, fontsize=fs)
                    tw1.write_text(page, color=rgb, morph=(pt, mu.Matrix(-a_out)))
                else:
                    tw = writers.get(rgb)
                    if tw is None:
                        tw = writers[rgb] = mu.TextWriter(page.rect)
                    tw.append(pt, line, font=font, fontsize=fs)
                n += 1
        except Exception:
            continue
    for rgb, tw in writers.items():
        tw.write_text(page, color=rgb)
    return n


def force_thai_font(doc) -> None:
    font = os.environ.get("PDF_THAI_FONT", "Loma.ttf")
    for style in doc.styles:
        try:
            style.dxf.font = font
            style.dxf.bigfont = ""
        except Exception:
            pass


def thin_entity_lineweights(doc) -> int:
    """ลด lineweight ของ entity / เลเยอร์ ที่ตั้งหนาเกินไปในไฟล์ต้น
    (ค่า 0 = default ตามเลเยอร์, ติดลบ = default)
    """
    n = 0
    # เพดาน ~0.25 มม. ในหน่วย DXF lineweight (100 = 1.00 มม.)
    max_lw = int(float(os.environ.get("PDF_ENTITY_MAX_LW", "25")))  # 0.25 mm

    def clamp_lw(e):
        nonlocal n
        try:
            if not e.dxf.hasattr("lineweight"):
                return
            lw = int(e.dxf.lineweight)
            if lw > max_lw:
                e.dxf.lineweight = max_lw
                n += 1
        except Exception:
            pass

    for layer in doc.layers:
        try:
            lw = int(layer.dxf.lineweight) if layer.dxf.hasattr("lineweight") else -1
            if lw > max_lw:
                layer.dxf.lineweight = max_lw
                n += 1
        except Exception:
            pass

    for e in doc.modelspace():
        clamp_lw(e)
    for b in doc.blocks:
        if b.name.startswith("*"):
            continue
        for e in b:
            clamp_lw(e)
    return n


def build_draw_config() -> Configuration:
    """เส้นบางมาก — สัญลักษณ์ไฟฟ้ากลวงต้องไม่ถูกอุดด้วยเส้นหนา"""
    min_lw = float(os.environ.get("PDF_MIN_LINEWEIGHT_MM", "0.01"))
    kwargs = dict(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.COLOR,
        text_policy=TextPolicy.IGNORE,
        min_lineweight=min_lw,
        lineweight_scaling=float(os.environ.get("PDF_LINEWEIGHT_SCALING", "0.35")),
        max_lineweight=float(os.environ.get("PDF_MAX_LINEWEIGHT_MM", "0.25")),
    )
    if LineweightPolicy is not None:
        try:
            kwargs["lineweight_policy"] = LineweightPolicy.ABSOLUTE
        except Exception:
            pass
    try:
        return Configuration(**kwargs)
    except TypeError:
        return Configuration(
            background_policy=BackgroundPolicy.WHITE,
            color_policy=ColorPolicy.COLOR,
            text_policy=TextPolicy.IGNORE,
            min_lineweight=min_lw,
        )


def main(src: str, dst: str, texts_out: str = "") -> None:
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

    ezfonts.build_system_font_cache()
    force_thai_font(doc)
    msp = doc.modelspace()
    ext = bbox.extents(msp, fast=True)
    if not ext.has_data:
        raise SystemExit("ไม่พบเส้น/วัตถุในผังหลัก (Model space ว่าง)")

    from collections import Counter

    kinds = Counter(e.dxftype() for e in msp)
    print(f"Model space: {sum(kinds.values())} วัตถุ → " + ", ".join(f"{k}={v}" for k, v in kinds.most_common(10)))
    print(f"Extents: x {ext.extmin.x:.0f}..{ext.extmax.x:.0f}  y {ext.extmin.y:.0f}..{ext.extmax.y:.0f}")
    off = [l.dxf.name for l in doc.layers if not l.is_on() or l.is_frozen()]
    print(f"เลเยอร์ทั้งหมด {len(doc.layers)} (ปิด/แช่แข็ง {len(off)}), บล็อก {len(doc.blocks)}")

    for layer in doc.layers:
        try:
            layer.on()
            layer.thaw()
        except Exception:
            pass

    n_lw = thin_entity_lineweights(doc)
    if n_lw:
        print(f"ลด lineweight ที่หนาเกิน {n_lw} จุด")

    w = max(ext.size.x, 1e-6)
    h = max(ext.size.y, 1e-6)
    aspect = min(max(w / h, 1 / MAX_ASPECT), MAX_ASPECT)
    if aspect >= 1:
        page_w, page_h = LONG_SIDE_MM, LONG_SIDE_MM / aspect
    else:
        page_w, page_h = LONG_SIDE_MM * aspect, LONG_SIDE_MM

    cfg = build_draw_config()
    print(
        f"lineweight: min={getattr(cfg, 'min_lineweight', '?')} mm, "
        f"scale={getattr(cfg, 'lineweight_scaling', '?')}, "
        f"max={getattr(cfg, 'max_lineweight', '?')} mm"
    )
    ctx = RenderContext(doc)
    backend = ezpdf.PyMuPdfBackend()
    Frontend(ctx, backend, config=cfg).draw_layout(msp, finalize=True)

    page_def = layout.Page(page_w, page_h, layout.Units.mm, margins=layout.Margins.all(5))
    settings = layout.Settings(fit_page=True)
    render_box = BoundingBox2d([(ext.extmin.x, ext.extmin.y), (ext.extmax.x, ext.extmax.y)])

    out_layout = layout.Layout(render_box, flip_y=True)
    final_page = out_layout.get_final_page(page_def, settings)
    st2 = copy.copy(settings)
    st2.output_coordinate_space = ezpdf.get_coordinate_output_space(final_page)
    m = out_layout.get_placement_matrix(final_page, settings=st2, top_origin=True)

    replay = backend.get_replay(page_def, settings=settings, render_box=render_box)
    pdf = replay.get_pdf_bytes()

    texts = collect_texts(doc, msp)
    doc_pdf = mu.open(stream=pdf, filetype="pdf")
    index: list = []
    n_text = place_texts(doc_pdf[0], m, texts, find_thai_font(), index)
    if texts_out:
        import json

        seen = set()
        items = []
        for t, x, y, fs in index:
            t = t.encode("utf-8", "ignore").decode("utf-8", "ignore").replace("\ufffd", "").strip()
            if not t:
                continue
            k = (t, round(x / 4), round(y / 4))
            if k in seen:
                continue
            seen.add(k)
            items.append([t, round(x, 1), round(y, 1), round(fs, 2)])
        with open(texts_out, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        print(f"ดัชนีข้อความ: {len(items)} รายการ → {texts_out}")
    print(f"ข้อความ: พบ {len(texts)} ชิ้น, ใส่ลง PDF {n_text} บรรทัด")
    pdf = doc_pdf.tobytes(garbage=3, deflate=True)
    doc_pdf.close()
    with open(dst, "wb") as f:
        f.write(pdf)
    try:
        with mu.open(dst) as d:
            pg = d[0]
            print(f"ในหน้า PDF: เส้น/รูปทรง {len(pg.get_drawings())} ชิ้น, ตัวอักษร {len(pg.get_text())} ตัว")
    except Exception as e:
        print(f"(ตรวจ PDF ไม่ได้: {e})")
    print(f"PDF ok: {dst} ({len(pdf)/1048576:.1f} MB, page {page_w:.0f}x{page_h:.0f} mm)")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
