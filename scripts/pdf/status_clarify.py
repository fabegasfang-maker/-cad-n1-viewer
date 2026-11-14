"""Status symbol blocks (open/close/sf6): outline solid fills so switch internals stay visible."""

def _is_solid_hatch(e) -> bool:
    try:
        if e.dxftype() != "HATCH":
            return False
        if bool(getattr(e.dxf, "solid_fill", False)):
            return True
        return (e.dxf.pattern_name or "").upper() in ("SOLID", "")
    except Exception:
        return False


def _hatch_to_outline(layout, hatch) -> int:
    n = 0
    try:
        layer = hatch.dxf.layer if hatch.dxf.hasattr("layer") else "0"
        color = hatch.dxf.color if hatch.dxf.hasattr("color") else 256
        true_color = hatch.dxf.true_color if hatch.dxf.hasattr("true_color") else None
        attribs = {"layer": layer, "color": color, "lineweight": 18}
        if true_color is not None:
            attribs["true_color"] = true_color
        for path in hatch.paths:
            pts = []
            try:
                if hasattr(path, "vertices"):
                    for v in path.vertices:
                        if hasattr(v, "x"):
                            pts.append((float(v.x), float(v.y)))
                        elif isinstance(v, (list, tuple)) and len(v) >= 2:
                            pts.append((float(v[0]), float(v[1])))
                if hasattr(path, "edges") and not pts:
                    import math
                    for edge in path.edges:
                        try:
                            et = type(edge).__name__
                            if "Line" in et or (hasattr(edge, "start") and hasattr(edge, "end")):
                                s, e_ = edge.start, edge.end
                                if not pts:
                                    pts.append((float(s[0]), float(s[1])))
                                pts.append((float(e_[0]), float(e_[1])))
                            elif "Arc" in et or hasattr(edge, "center"):
                                center = edge.center
                                r = float(edge.radius)
                                a0 = math.radians(float(edge.start_angle))
                                a1 = math.radians(float(edge.end_angle))
                                if a1 < a0:
                                    a1 += 2 * math.pi
                                steps = max(8, int(abs(a1 - a0) / (math.pi / 12)))
                                for i in range(steps + 1):
                                    a = a0 + (a1 - a0) * i / steps
                                    pts.append(
                                        (
                                            float(center[0]) + r * math.cos(a),
                                            float(center[1]) + r * math.sin(a),
                                        )
                                    )
                        except Exception:
                            continue
            except Exception:
                continue
            if len(pts) < 2:
                continue
            closed = abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6
            try:
                pl = layout.add_lwpolyline(pts, close=closed, dxfattribs=attribs)
                pl.dxf.const_width = 0.0
                n += 1
            except Exception:
                pass
    except Exception:
        pass
    return n


def clarify_status_symbol_blocks(doc) -> None:
    """Blocks named open/close/sf6: remove solid HATCH/SOLID, keep internal switch lines.

    Users overlay open/close blocks on base switches in the same DWG.
    """
    import re

    name_re = re.compile(r"(open|close|sf6|recloser|switch|breaker|isolat)", re.I)
    blocks_hit = []
    outlined = 0
    removed = 0
    width_cleared = 0

    for b in doc.blocks:
        name = b.name or ""
        if name.startswith("*"):
            continue
        if not name_re.search(name):
            continue
        blocks_hit.append(name)
        to_replace = []
        to_delete = []
        for e in list(b):
            t = e.dxftype()
            if t == "HATCH" and _is_solid_hatch(e):
                to_replace.append(e)
            elif t in ("SOLID", "TRACE"):
                to_delete.append(e)
            elif t == "LWPOLYLINE":
                try:
                    w = float(e.dxf.const_width) if e.dxf.hasattr("const_width") else 0.0
                    if abs(w) > 1e-6:
                        e.dxf.const_width = 0.0
                        width_cleared += 1
                    if e.has_width:
                        pts = list(e.get_points("xyseb"))
                        e.set_points(
                            [(p[0], p[1], 0.0, 0.0, p[4] if len(p) > 4 else 0.0) for p in pts],
                            format="xyseb",
                        )
                        width_cleared += 1
                except Exception:
                    pass
        for e in to_replace:
            outlined += _hatch_to_outline(b, e)
            try:
                b.delete_entity(e)
                removed += 1
            except Exception:
                try:
                    e.destroy()
                    removed += 1
                except Exception:
                    pass
        for e in to_delete:
            try:
                b.delete_entity(e)
                removed += 1
            except Exception:
                try:
                    e.destroy()
                    removed += 1
                except Exception:
                    pass

    try:
        msp = doc.modelspace()
        order = []
        for idx, ent in enumerate(msp):
            h = getattr(ent.dxf, "handle", None)
            if not h:
                continue
            t = ent.dxftype()
            pri = 1
            if t in ("HATCH", "SOLID", "TRACE"):
                pri = 0
            elif t == "INSERT":
                nm = ent.dxf.name or ""
                pri = 3 if name_re.search(nm) else 2
            order.append((h, f"{pri:01x}{idx:07x}"))
        if order:
            msp.set_redraw_order(order)
    except Exception:
        pass

    sample = ", ".join(blocks_hit[:12])
    more = f" (+{len(blocks_hit)-12})" if len(blocks_hit) > 12 else ""
    print(
        f"status symbols: blocks={len(blocks_hit)} [{sample}{more}], "
        f"hatch->outline={outlined}, removed_solid={removed}, width_cleared={width_cleared}"
    )
