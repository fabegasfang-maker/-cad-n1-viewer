#!/usr/bin/env python3
"""PDF (หน้าเดียว) -> กระเบื้องภาพแบบแผนที่ (WebP 256px หลายระดับซูม) + meta.json + index.json

ใช้: make-tiles.py in.pdf texts.json out_dir
"""
import json
import math
import os
import shutil
import sys
import time
from multiprocessing import Pool

import numpy as np
import pymupdf as mu
from PIL import Image

TILE = 256
CHUNK_TILES = 8
TARGET_TEXT_PX = float(os.environ.get("TILE_TARGET_TEXT_PX", "14"))
MIN_WIDTH_PX = int(os.environ.get("TILE_MIN_WIDTH_PX", "12288"))
MAX_WIDTH_PX = int(os.environ.get("TILE_MAX_WIDTH_PX", "65536"))
WEBP_QUALITY = int(os.environ.get("TILE_WEBP_QUALITY", "90"))
WEBP_LOSSLESS = os.environ.get("TILE_WEBP_LOSSLESS", "1") == "1"
# เดิม boost แรง → วงกลมกลวง/สัญลักษณ์ SF6 กลายเป็นก้อนทึบตอนซูมออก
LINE_BOOST_BASE = float(os.environ.get("TILE_LINE_BOOST_BASE", "1.12"))
LINE_BOOST_MAX = float(os.environ.get("TILE_LINE_BOOST_MAX", "1.85"))

_doc = None
_dl = None
_cfg = None


def _init(pdf_path, cfg):
    global _doc, _dl, _cfg
    _doc = mu.open(pdf_path)
    _dl = _doc[0].get_displaylist()
    _cfg = cfg


def level_dims(cfg, z):
    f = 2 ** (cfg["maxZoom"] - z)
    return math.ceil(cfg["w"] / f), math.ceil(cfg["h"] / f)


def render_chunk(task):
    z, cx, cy = task
    cfg = _cfg
    wz, hz = level_dims(cfg, z)
    scale = cfg["scale"] / 2 ** (cfg["maxZoom"] - z)
    px0, py0 = cx * CHUNK_TILES * TILE, cy * CHUNK_TILES * TILE
    cw = min(CHUNK_TILES * TILE, wz - px0)
    ch = min(CHUNK_TILES * TILE, hz - py0)
    if cw <= 0 or ch <= 0:
        return 0
    pad = 1.0 / scale
    area = mu.Rect(px0 / scale - pad, py0 / scale - pad, (px0 + cw) / scale + pad, (py0 + ch) / scale + pad)
    pix = _dl.get_pixmap(matrix=mu.Matrix(scale, scale), clip=area, alpha=False)
    src = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    arr = np.full((ch, cw, 3), 255, dtype=np.uint8)
    ox, oy = pix.x - px0, pix.y - py0
    sx0, sy0 = max(0, -ox), max(0, -oy)
    dx0, dy0 = max(0, ox), max(0, oy)
    wcopy = min(pix.width - sx0, cw - dx0)
    hcopy = min(pix.height - sy0, ch - dy0)
    if wcopy > 0 and hcopy > 0:
        arr[dy0 : dy0 + hcopy, dx0 : dx0 + wcopy] = src[sy0 : sy0 + hcopy, sx0 : sx0 + wcopy]
    if arr.min() == 255:
        return 0

    # ชดเชยเส้นจางตอนซูมออก — เบาลงจากเดิมมาก เพื่อไม่ให้อุปกรณ์กลวงกลายเป็นจุดทึบ
    levels_out = cfg["maxZoom"] - z
    if levels_out > 0:
        k = min(LINE_BOOST_MAX, LINE_BOOST_BASE ** levels_out)
        if k > 1.01:
            # ใช้ gamma เบาๆ แทนการคูณตรงๆ ทั้งพิกเซล — ขอบเส้นเข้มขึ้น แต่รูกลวงยังว่าง
            f = arr.astype(np.float32) / 255.0
            # ดันเฉพาะพิกเซลที่ใกล้สีเข้ม (เส้น) ไม่ดันทั้งพื้น
            inv = 1.0 - f
            boosted = 1.0 - np.minimum(1.0, inv * k)
            # ผสมกับต้นฉบับ 70/30 เพื่อไม่บวมเกิน
            mix = 0.65
            out = (f * (1 - mix) + boosted * mix) * 255.0
            arr = out.astype(np.uint8)

    n = 0
    for ty in range(0, ch, TILE):
        for tx in range(0, cw, TILE):
            t = arr[ty : ty + TILE, tx : tx + TILE]
            if t.min() == 255:
                continue
            if t.shape[0] != TILE or t.shape[1] != TILE:
                full = np.full((TILE, TILE, 3), 255, dtype=np.uint8)
                full[: t.shape[0], : t.shape[1]] = t
                t = full
            x = (px0 + tx) // TILE
            y = (py0 + ty) // TILE
            d = os.path.join(cfg["out"], "tiles", str(z), str(x))
            os.makedirs(d, exist_ok=True)
            Image.fromarray(t).save(
                os.path.join(d, f"{y}.webp"),
                "WEBP",
                quality=WEBP_QUALITY,
                method=4,
                lossless=WEBP_LOSSLESS,
            )
            n += 1
    return n


def main(pdf_path, texts_path, out_dir):
    t0 = time.time()
    doc = mu.open(pdf_path)
    rect = doc[0].rect
    with open(texts_path, encoding="utf-8") as f:
        items = json.load(f)

    sizes = sorted(i[3] for i in items if i[3] > 0)
    p10 = sizes[len(sizes) // 10] if sizes else 4.0
    scale = TARGET_TEXT_PX / max(p10, 0.01)
    width = min(max(rect.width * scale, MIN_WIDTH_PX), MAX_WIDTH_PX)
    scale = width / rect.width
    w, h = math.ceil(rect.width * scale), math.ceil(rect.height * scale)
    max_zoom = max(0, math.ceil(math.log2(max(w, h) / TILE)))
    cfg = {"w": w, "h": h, "scale": scale, "maxZoom": max_zoom, "out": out_dir}
    print(
        f"หน้า PDF {rect.width:.0f}x{rect.height:.0f} pt | ตัวหนังสือเล็ก(p10) {p10:.2f} pt "
        f"→ ภาพละเอียดสุด {w}x{h} px, ซูม 0..{max_zoom}, targetText={TARGET_TEXT_PX}px"
    )

    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(os.path.join(out_dir, "tiles"), exist_ok=True)

    tasks = []
    for z in range(max_zoom, -1, -1):
        wz, hz = level_dims(cfg, z)
        for cy in range(math.ceil(hz / (CHUNK_TILES * TILE))):
            for cx in range(math.ceil(wz / (CHUNK_TILES * TILE))):
                tasks.append((z, cx, cy))
    procs = max(1, os.cpu_count() or 1)
    print(f"เรนเดอร์ {len(tasks)} ชิ้นงาน ด้วย {procs} โปรเซส")
    total = 0
    with Pool(procs, initializer=_init, initargs=(pdf_path, cfg)) as pool:
        for i, n in enumerate(pool.imap_unordered(render_chunk, tasks, chunksize=1), 1):
            total += n
            if i % 50 == 0:
                print(f"  {i}/{len(tasks)} ชิ้นงาน, กระเบื้อง {total}, {time.time() - t0:.0f}s", flush=True)

    idx = []
    for t, x, y, fs in items:
        if not t:
            continue
        x_px = round((x + min(len(t), 30) * fs * 0.28) * scale)
        y_px = round((y - fs * 0.3) * scale)
        fs_px = max(1, round(fs * scale))
        idx.append([t, x_px, y_px, fs_px])

    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 2, "items": idx}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "w": w,
                "h": h,
                "tile": TILE,
                "maxZoom": max_zoom,
                "format": "webp",
                "tiles": total,
                "targetTextPx": TARGET_TEXT_PX,
            },
            f,
            ensure_ascii=False,
        )

    size = sum(os.path.getsize(os.path.join(r, fn)) for r, _, fs_ in os.walk(out_dir) for fn in fs_)
    print(f"เสร็จ: กระเบื้อง {total} ไฟล์, รวม {size / 1048576:.1f} MB, ใช้เวลา {time.time() - t0:.0f}s")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:4])
