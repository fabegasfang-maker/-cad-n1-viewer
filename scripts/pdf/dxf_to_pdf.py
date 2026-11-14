#!/usr/bin/env python3
"""Restore pre-status-clarify dxf_to_pdf (commit 970275e0c3)."""
import pathlib
import runpy
import sys
import urllib.request

URL = (
    "https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/"
    "970275e0c3/scripts/pdf/dxf_to_pdf.py"
)


def main():
    dst = pathlib.Path(__file__).with_name("_dxf_to_pdf_real.py")
    if not dst.exists() or dst.stat().st_size < 5000:
        data = urllib.request.urlopen(URL, timeout=60).read()
        dst.write_bytes(data)
        print(f"restored dxf_to_pdf from 970275e0c3 -> {dst} ({len(data)} bytes)")
    sys.argv[0] = str(dst)
    runpy.run_path(str(dst), run_name="__main__")


if __name__ == "__main__":
    main()
