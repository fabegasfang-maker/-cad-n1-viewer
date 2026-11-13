#!/usr/bin/env python3
"""Bootstrap: fetch pre-AB make-tiles from known-good commit, then exec it."""
import pathlib, urllib.request, runpy, sys
URL = "https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/dd4bca2bd7ce8eb4c612843bb55569dfaeb36008/scripts/pdf/make-tiles.py"
dst = pathlib.Path(__file__).with_name("_make_tiles_real.py")
if not dst.exists() or dst.stat().st_size < 1000:
    print("fetching pre-AB make-tiles.py ...")
    data = urllib.request.urlopen(URL, timeout=60).read()
    dst.write_bytes(data)
    print(f"saved {len(data)} bytes -> {dst}")
sys.argv[0] = str(dst)
runpy.run_path(str(dst), run_name="__main__")
