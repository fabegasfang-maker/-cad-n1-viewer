#!/usr/bin/env python3
"""DXF -> PDF แบบเวกเตอร์ ทั้งแผนผังในหน้าเดียว (ขนาด A0) ใช้เป็นต้นทางสร้างกระเบื้องแผนที่

ใช้: dxf_to_pdf.py in.dxf out.pdf [texts.json]
"""
import copy
import dataclasses
import math
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")

import ezdxf
import pymupdf as mu
from ezdxf import bbox, recover
from ezdxf import colors as ezcolors
from ezdxf.addons.drawing import Frontend, RenderContext, layout
from ezdxf.addons.drawing import pymupdf as ezpdf
from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration, TextPolicy
from ezdxf.fonts import fonts as ezfonts
from ezdxf.math import BoundingBox2d, Vec2
from ezdxf.render.trace import TraceBuilder

try:
    from ezdxf.addons.drawing.config import LineweightPolicy
except Exception:
    LineweightPolicy = None  # type: ignore

LONG_SIDE_MM = 1189.0
MAX_ASPECT = 6.0

_INT = re.compile(rb"^\s*-?\d+\s*$")
_STR_CODES = {1, 2, 3, 4, 6, 7, 8, 9, *range(300, 310), *range(1000, 1010)}


def _is_valid_group_code(line: bytes) -> bool:
    if not _INT.match(line):
        return False
    try:
        c = int(line.strip())
        return -5 <= c <= 1071
    except Exception:
        return False


_BAD_ESC = re.compile(rb"\\U\+(?![0-9A-Fa-f]{4})|\\M\+(?![0-9A-Fa-f]{5})")


def sanitize_dxf(src: str, dst: str) -> int:
    with open(src, "rb") as f:
        lines = f.read().split(b"\n")
    out: list[bytes] = []
    fixed = 0
    i = 0
    n = len(lines)
    while i < n:
        code_line = lines[i]
        if not code_line.strip() and i == n - 1:
            break
        if _is_valid_group_code(code_line) and i + 1 < n:
            code_num = int(code_line.strip())
            out.append(code_line)
            out.append(lines[i + 1])
            i += 2
            if code_num in _STR_CODES:
                while i < n and lines[i].strip() and not _is_valid_group_code(lines[i]):
                    out[-1] = out[-1].rstrip(b"\r") + b" " + lines[i].rstrip(b"\r")
                    fixed += 1
                    i += 1
        else:
            fixed += 1
            i += 1
    data = b"\n".join(out) + b"\n"
    # รหัส unicode แบบ \U+XXXX / \M+XXXXX ที่เลขไม่ครบ (LibreDWG แปลงข้อความเสียบางตัว) ทำให้ ezdxf พังตอนถอดรหัส → ตัดทิ้ง
    data, n_bad = _BAD_ESC.subn(b"", data)
    fixed += n_bad
    with open(dst, "wb") as f:
        f.write(data)
    return fixed


def load_dxf_document(src: str):
    """ใช้ recover.readfile เป็นหลักเพื่อซ่อม duplicate entity handle ไม่ให้เอนทิตีทับกันหาย"""
    try:
        doc, auditor = recover.readfile(src)
        if auditor.has_fixes or auditor.has_errors:
            print(f"ตรวจซ่อมโครงสร้าง DXF อัตโนมัติ: แก้ไข {len(auditor.fixes)} จุด, แจ้งเตือน {len(auditor.errors)} จุด")
        return doc
    except Exception as e1:
        print(f"recover.readfile รอบแรกไม่ผ่าน ({type(e1).__name__}) -> ซ่อมบรรทัดข้อความก่อนอ่านใหม่...")
        fixed_path = src + ".fixed.dxf"
        n_fixed = sanitize_dxf(src, fixed_path)
        print(f"ซ่อมบรรทัดข้อความ DXF {n_fixed} จุด")
        doc, _ = recover.readfile(fixed_path)
        return doc


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

    def is_layer_visible(layer_name: str) -> bool:
        if layer_name not in doc.layers:
            return True
        lyr = doc.layers.get(layer_name)
        return lyr.is_on() and not lyr.is_frozen()

    def emit(e, parent_aci):
        if e.dxf.hasattr("layer") and not is_layer_visible(e.dxf.layer):
            return
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
            if e.dxf.hasattr("invisible") and e.dxf.invisible:
                continue
            if e.dxf.hasattr("layer") and not is_layer_visible(e.dxf.layer):
                continue
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
                if depth < 5 and e.dxf.name in with_text:
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
                first = {0: -h, 1: (nl - 1) * lh / 2 - h / 2, 2: -h + (nl - 1) * lh}[vpos]
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


def normalize_layers(doc) -> None:
    total = len(doc.layers)
    off = [l for l in doc.layers if not l.is_on() or l.is_frozen()]
    print(f"เลเยอร์ทั้งหมด {total} (ปิด/แช่แข็ง {len(off)}), บล็อก {len(doc.blocks)}")
    if total > 0 and len(off) >= total:
        print("ตรวจพบทุกเลเยอร์ถูกตั้งค่าปิด -> เปิดแสดงผลทุกเลเยอร์")
        for layer in doc.layers:
            try:
                if layer.dxf.name.upper() != "DEFPOINTS":
                    layer.on()
                    layer.thaw()
            except Exception:
                pass
    else:
        for layer in doc.layers:
            try:
                if layer.dxf.name.upper() == "DEFPOINTS":
                    layer.off()
            except Exception:
                pass


def _is_white_mask_fill(doc, e) -> bool:
    try:
        if e.dxf.hasattr("true_color"):
            r, g, b = ezcolors.int2rgb(e.dxf.true_color)
            return r > 242 and g > 242 and b > 242
        aci = abs(int(e.dxf.color)) if e.dxf.hasattr("color") else 256
        if aci == 256 and e.dxf.hasattr("layer") and e.dxf.layer in doc.layers:
            lyr = doc.layers.get(e.dxf.layer)
            if lyr.dxf.hasattr("true_color"):
                r, g, b = ezcolors.int2rgb(lyr.dxf.true_color)
                return r > 242 and g > 242 and b > 242
            aci = abs(int(lyr.color))
        return aci == 255
    except Exception:
        return False


def _adjust_stroke_rgb_for_white(r: int, g: int, b: int):
    if r < 40 and g > 220 and b < 40:
        return (0, 180, 0)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    if lum <= 195:
        return None
    if r > 220 and g > 220 and b < 60:
        return (180, 120, 0)
    if max(r, g, b) - min(r, g, b) < 20:
        return (85, 85, 85)
    factor = 145.0 / max(lum, 1.0)
    return (
        max(0, min(255, int(round(r * factor)))),
        max(0, min(255, int(round(g * factor)))),
        max(0, min(255, int(round(b * factor)))),
    )


def prepare_entities_for_white_bg(doc, msp) -> None:
    """ลบ WIPEOUT/พื้นขาวบังเส้น, ซ่อมเส้น Polyline ความยาวศูนย์ที่ทำให้ TraceBuilder พัง, และปรับสีบนพื้นขาว"""
    stroke_types = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "LEADER"}
    removed_masks = 0
    fixed_geom = 0
    darkened = 0

    # ปรับสีเลเยอร์ที่อ่อนเกินไปบนพื้นขาวที่ระดับตารางเลเยอร์ (คงพฤติกรรม BYBLOCK / เลเยอร์ 0 ในบล็อก)
    for lyr in doc.layers:
        try:
            rgb = None
            if lyr.dxf.hasattr("true_color"):
                rgb = ezcolors.int2rgb(lyr.dxf.true_color)
            else:
                aci = abs(int(lyr.color))
                if aci not in (0, 7, 256):
                    rgb = ezcolors.aci2rgb(aci)
            if rgb is not None:
                adj = _adjust_stroke_rgb_for_white(*rgb)
                if adj is not None:
                    lyr.rgb = adj
                    darkened += 1
        except Exception:
            pass

    def process_container(container):
        nonlocal removed_masks, fixed_geom, darkened
        for e in list(container):
            t = e.dxftype()
            if t == "WIPEOUT":
                try:
                    container.delete_entity(e)
                    removed_masks += 1
                except Exception:
                    pass
                continue

            if t in ("HATCH", "SOLID", "TRACE") and _is_white_mask_fill(doc, e):
                try:
                    container.delete_entity(e)
                    removed_masks += 1
                except Exception:
                    pass
                continue

            # ป้องกัน IndexError ใน ezdxf TraceBuilder.from_polyline จากเส้นความยาว 0 หรือจุดไม่ครบ
            if t == "LWPOLYLINE":
                try:
                    if len(e) < 2:
                        container.delete_entity(e)
                        fixed_geom += 1
                        continue
                    if e.has_width:
                        try:
                            TraceBuilder.from_polyline(e)
                        except Exception:
                            pts = list(e.get_points("xyb"))
                            if len(pts) < 2 or all(
                                abs(p[0] - pts[0][0]) < 1e-8 and abs(p[1] - pts[0][1]) < 1e-8
                                for p in pts[1:]
                            ):
                                container.delete_entity(e)
                            else:
                                e.dxf.const_width = 0.0
                                e.set_points([(p[0], p[1], 0.0, 0.0, p[2]) for p in pts], format="xyseb")
                            fixed_geom += 1
                            continue
                except Exception:
                    try:
                        container.delete_entity(e)
                        fixed_geom += 1
                    except Exception:
                        pass
                    continue

            elif t == "POLYLINE":
                try:
                    verts = list(getattr(e, "vertices", []))
                    if len(verts) < 2:
                        container.delete_entity(e)
                        fixed_geom += 1
                        continue
                    try:
                        TraceBuilder.from_polyline(e)
                    except Exception:
                        container.delete_entity(e)
                        fixed_geom += 1
                        continue
                except Exception:
                    try:
                        container.delete_entity(e)
                        fixed_geom += 1
                    except Exception:
                        pass
                    continue

            elif t == "LEADER":
                try:
                    if len(list(e.vertices)) < 2:
                        container.delete_entity(e)
                        fixed_geom += 1
                        continue
                except Exception:
                    pass

            elif t == "MTEXT":
                try:
                    if e.dxf.hasattr("bg_fill"):
                        e.dxf.bg_fill = 0
                except Exception:
                    pass

            if t in stroke_types:
                try:
                    rgb = None
                    if e.dxf.hasattr("true_color"):
                        rgb = ezcolors.int2rgb(e.dxf.true_color)
                    elif e.dxf.hasattr("color"):
                        aci = abs(int(e.dxf.color))
                        if aci not in (0, 7, 256):
                            rgb = ezcolors.aci2rgb(aci)
                    if rgb is not None:
                        adj = _adjust_stroke_rgb_for_white(*rgb)
                        if adj is not None:
                            e.dxf.true_color = ezcolors.rgb2int(adj)
                            darkened += 1
                except Exception:
                    pass

    # ประมวลผลทุกบล็อกในเอกสาร (รวม *Model_Space) รอบเดียวครบถ้วน
    for b in doc.blocks:
        if b.name.upper().startswith("*PAPER_SPACE"):
            continue
        process_container(b)

    # จัดลำดับวาดให้ HATCH / SOLID อยู่ด้านล่างสุดเสมอ (ไม่ให้บังเส้นไฟ)
    try:
        bg_types = {"HATCH", "SOLID", "TRACE"}
        order = []
        for idx, ent in enumerate(msp):
            h = getattr(ent.dxf, "handle", None)
            if h:
                pri = 0 if ent.dxftype() in bg_types else 1
                order.append((h, f"{pri:01x}{idx:07x}"))
        if order:
            msp.set_redraw_order(order)
    except Exception:
        pass

    print(
        f"ปรับแต่งผัง: ลบ WIPEOUT/พื้นขาวบังเส้น {removed_masks} ชิ้น, "
        f"ซ่อมเส้นความยาวศูนย์ {fixed_geom} ชิ้น, ปรับสีอ่อน {darkened} จุด"
    )


def safe_modelspace_extents(msp):
    """คำนวณขอบเขตผังแบบทนทาน หากมีเอนทิตีพิกัดเสียหลงเหลือจะคัดออกเฉพาะชิ้นนั้นโดยไม่ล่ม"""
    try:
        return bbox.extents(msp, fast=True)
    except Exception as err:
        print(f"พบเอนทิตีพิกัดเสียระหว่างคำนวณขอบเขต ({type(err).__name__}: {err}) -> คัดกรองรายชิ้น...")
        bad = 0
        res = BoundingBox2d()
        for e in list(msp):
            try:
                b = bbox.extents([e], fast=True)
                if b.has_data:
                    res.extend([b.extmin, b.extmax])
            except Exception:
                try:
                    msp.delete_entity(e)
                    bad += 1
                except Exception:
                    pass
        print(f"คัดเอนทิตีพิกัดเสียออกเพิ่มเติม {bad} ชิ้น")
        return res


def thin_entity_lineweights(doc) -> int:
    n = 0
    max_lw = int(float(os.environ.get("PDF_ENTITY_MAX_LW", "30")))

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

    for b in doc.blocks:
        if b.name.upper().startswith("*PAPER_SPACE"):
            continue
        for e in b:
            clamp_lw(e)
    return n


def build_draw_config() -> Configuration:
    min_lw_mm = float(os.environ.get("PDF_MIN_LINEWEIGHT_MM", "0.05"))
    min_lw_ez = max(0.45, min_lw_mm * (300.0 / 25.4))
    lw_scale = float(os.environ.get("PDF_LINEWEIGHT_SCALING", "0"))

    valid_fields = (
        {f.name for f in dataclasses.fields(Configuration)}
        if dataclasses.is_dataclass(Configuration)
        else {"background_policy", "color_policy", "text_policy", "min_lineweight", "lineweight_scaling", "lineweight_policy"}
    )
    kwargs = dict(
        background_policy=BackgroundPolicy.WHITE,
        color_policy=ColorPolicy.COLOR,
        text_policy=TextPolicy.IGNORE,
    )
    if "min_lineweight" in valid_fields:
        kwargs["min_lineweight"] = min_lw_ez
    if "lineweight_scaling" in valid_fields:
        kwargs["lineweight_scaling"] = lw_scale
    if LineweightPolicy is not None and "lineweight_policy" in valid_fields:
        try:
            kwargs["lineweight_policy"] = LineweightPolicy.ABSOLUTE
        except Exception:
            pass
    return Configuration(**kwargs)


def render_modelspace_safely(doc, msp, cfg):
    ctx = RenderContext(doc)
    backend = ezpdf.PyMuPdfBackend()
    try:
        Frontend(ctx, backend, config=cfg).draw_layout(msp, finalize=True)
        return backend
    except Exception as err:
        print(f"พบเอนทิตีที่วาดไม่ได้ระหว่างเรนเดอร์ ({type(err).__name__}: {err}) -> กรองเฉพาะชิ้นที่เสียแล้วเรนเดอร์ใหม่...")
        bad = 0
        for e in list(msp):
            try:
                bbox.extents([e], fast=False)
            except Exception:
                try:
                    msp.delete_entity(e)
                    bad += 1
                except Exception:
                    pass
        print(f"ตัดเอนทิตีที่เรนเดอร์ไม่ได้ออก {bad} ชิ้น")
        ctx2 = RenderContext(doc)
        backend2 = ezpdf.PyMuPdfBackend()
        Frontend(ctx2, backend2, config=cfg).draw_layout(msp, finalize=True)
        return backend2


def main(src: str, dst: str, texts_out: str = "") -> None:
    doc = load_dxf_document(src)
    ezfonts.build_system_font_cache()
    force_thai_font(doc)
    normalize_layers(doc)

    msp = doc.modelspace()
    prepare_entities_for_white_bg(doc, msp)

    ext = safe_modelspace_extents(msp)
    if not ext.has_data:
        raise SystemExit("ไม่พบเส้น/วัตถุในผังหลัก (Model space ว่าง)")

    from collections import Counter

    kinds = Counter(e.dxftype() for e in msp)
    print(f"Model space: {sum(kinds.values())} วัตถุ -> " + ", ".join(f"{k}={v}" for k, v in kinds.most_common(10)))
    print(f"Extents: x {ext.extmin.x:.0f}..{ext.extmax.x:.0f}  y {ext.extmin.y:.0f}..{ext.extmax.y:.0f}")

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
        f"lineweight config: min_ez={getattr(cfg, 'min_lineweight', 0.0):.2f} (1/300 in), "
        f"scale={getattr(cfg, 'lineweight_scaling', '?')}"
    )
    backend = render_modelspace_safely(doc, msp, cfg)

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
        print(f"ดัชนีข้อความ: {len(items)} รายการ -> {texts_out}")
    print(f"ข้อความ: พบ {len(texts)} ชิ้น, ใส่ลง PDF {n_text} บรรทัด")
    pdf = doc_pdf.tobytes(garbage=3, deflate=True)
    doc_pdf.close()
    with open(dst, "wb") as f:
        f.write(pdf)
    try:
        with mu.open(dst) as d:
            pg = d[0]
            drawings = pg.get_drawings()
            widths = [dr["width"] for dr in drawings if dr.get("width") is not None]
            w_info = f", stroke pt min={min(widths):.3f} max={max(widths):.3f}" if widths else ""
            print(f"ในหน้า PDF: เส้น/รูปทรง {len(drawings)} ชิ้น{w_info}, ตัวอักษร {len(pg.get_text())} ตัว")
    except Exception as e:
        print(f"(ตรวจ PDF ไม่ได้: {e})")
    print(f"PDF ok: {dst} ({len(pdf)/1048576:.1f} MB, page {page_w:.0f}x{page_h:.0f} mm)")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    main(*sys.argv[1:])