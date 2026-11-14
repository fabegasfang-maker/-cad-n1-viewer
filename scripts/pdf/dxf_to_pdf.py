#!/usr/bin/env python3
"""dxf_to_pdf entry: known-good base + status_clarify for open/close overlays."""
import pathlib
import runpy
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
URL = (
    "https://raw.githubusercontent.com/fabegasfang-maker/-cad-n1-viewer/"
    "b805aab2acc348892918949347b50d1fd3830514/scripts/pdf/dxf_to_pdf.py"
)


def main():
    raw = urllib.request.urlopen(URL, timeout=60).read().decode("utf-8", "replace")
    if "clarify_status_symbol_blocks" not in raw:
        inject = (
            "\nimport importlib.util as _ilu\n"
            "import pathlib as _pl\n"
            "_sc = _ilu.spec_from_file_location(\n"
            "    'status_clarify',\n"
            "    str(_pl.Path(__file__).resolve().parent / 'status_clarify.py'),\n"
            ")\n"
            "_sm = _ilu.module_from_spec(_sc); _sc.loader.exec_module(_sm)\n"
            "clarify_status_symbol_blocks = _sm.clarify_status_symbol_blocks\n"
        )
        anchor = "from ezdxf.render.trace import TraceBuilder\n"
        if anchor in raw:
            raw = raw.replace(anchor, anchor + inject, 1)
        else:
            raw = inject + "\n" + raw
        old = "    prepare_entities_for_white_bg(doc, msp)\n"
        new = "    prepare_entities_for_white_bg(doc, msp)\n    clarify_status_symbol_blocks(doc)\n"
        if "clarify_status_symbol_blocks(doc)" not in raw:
            if old not in raw:
                raise SystemExit("prepare call missing in base")
            raw = raw.replace(old, new, 1)
    dst = HERE / "_dxf_to_pdf_real.py"
    dst.write_text(raw, encoding="utf-8")
    print(f"status clarify wired -> {dst} ({len(raw)} bytes)")
    sys.argv[0] = str(dst)
    runpy.run_path(str(dst), run_name="__main__")


if __name__ == "__main__":
    main()
