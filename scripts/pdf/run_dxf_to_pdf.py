#!/usr/bin/env python3
"""Wrapper: load dxf_to_pdf.main and run clarify_status_symbol_blocks before draw."""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: run_dxf_to_pdf.py in.dxf out.pdf [texts.json]")
    D = _load("dxf_to_pdf", HERE / "dxf_to_pdf.py")
    S = _load("status_clarify", HERE / "status_clarify.py")

    # Monkey-patch: after prepare_entities, also clarify status blocks
    _orig_prepare = D.prepare_entities_for_white_bg

    def _prepare(doc, msp):
        _orig_prepare(doc, msp)
        S.clarify_status_symbol_blocks(doc)

    D.prepare_entities_for_white_bg = _prepare
    D.main(*sys.argv[1:])


if __name__ == "__main__":
    main()
