"""
Generates the transistor symbol variants for \\ctikzset{transistors/arrow pos=end}.

For every transistor variant in src/data/symbols.svg, the variant is rendered twice with circuitikz (latex + dvisvgm),
once with the legacy arrow position and once with arrow pos=end. The arrow paths which differ between both renderings
are swapped in a copy of the original symbol, which is added to symbols.svg with the id "<original id>_arrowend".
Variants without arrows are skipped. Previously generated "_arrowend" symbols are replaced.

Requires latex, circuitikz and dvisvgm. Usage: python3 scripts/generateArrowEndSymbols.py
"""

import copy
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

SYMBOLS_FILE = Path(__file__).resolve().parent.parent / "src" / "data" / "symbols.svg"
SVG_NS = "http://www.w3.org/2000/svg"
SUFFIX = "_arrowend"
# dvisvgm outputs big points, the symbols are in px
BP_TO_PX = 96 / 72
# the fixed bounding box (in cm) of each rendered picture, such that the tikz origin is the center of the page
HALF_BOX_CM = 4
CM_TO_BP = 72 / 2.54
MATCH_TOLERANCE = 0.05


def render(entries: list[tuple[str, str]], arrow_pos: str, workdir: Path) -> list[ET.Element]:
    """render every (tikz name, options) entry as one page and return the parsed svg of each page"""
    pictures = []
    for tikz_name, options in entries:
        node_options = ", ".join([tikz_name] + ([options] if options else []))
        pictures.append(
            "\\begin{tikzpicture}\n"
            f"\\ctikzset{{transistors/arrow pos={arrow_pos}}}\n"
            f"\\useasboundingbox (-{HALF_BOX_CM},-{HALF_BOX_CM}) rectangle ({HALF_BOX_CM},{HALF_BOX_CM});\n"
            f"\\draw (0,0) node[{node_options}]{{}};\n"
            "\\end{tikzpicture}"
        )
    tex = (
        "\\documentclass[tikz,border=0pt]{standalone}\n\\usepackage{circuitikz}\n\\begin{document}\n"
        + "\n".join(pictures)
        + "\n\\end{document}\n"
    )
    name = "render_" + arrow_pos
    (workdir / (name + ".tex")).write_text(tex)
    subprocess.run(
        ["latex", "-interaction=nonstopmode", "-halt-on-error", name + ".tex"],
        cwd=workdir,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    subprocess.run(
        ["dvisvgm", "--no-fonts", "--page=1-", "--output=" + name + "-%p.svg", name + ".dvi"],
        cwd=workdir,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    pages = sorted(workdir.glob(name + "-*.svg"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    if len(pages) != len(entries):
        raise RuntimeError(f"expected {len(entries)} pages, got {len(pages)}")
    return [ET.parse(page).getroot() for page in pages]


def drawn_paths(page: ET.Element) -> list[ET.Element]:
    return [element for element in page.iter("{%s}path" % SVG_NS)]


def path_key(element: ET.Element) -> str:
    return repr(sorted(element.attrib.items()))


NUMBER = r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def transform_path(d: str, origin: tuple[float, float], mid: tuple[float, float]) -> str:
    """transform an absolute dvisvgm path from page coordinates to symbol coordinates"""
    tokens = re.findall(r"[A-Za-z]|" + NUMBER, d)
    out = []
    command = None
    numbers: list[float] = []

    def tx(x: float) -> float:
        return (x - origin[0]) * BP_TO_PX + mid[0]

    def ty(y: float) -> float:
        return (y - origin[1]) * BP_TO_PX + mid[1]

    def flush():
        if command is None:
            return
        if command in "ML C Q".replace(" ", ""):
            values = [tx(v) if i % 2 == 0 else ty(v) for i, v in enumerate(numbers)]
        elif command == "H":
            values = [tx(v) for v in numbers]
        elif command == "V":
            values = [ty(v) for v in numbers]
        elif command == "Z":
            values = []
        else:
            raise ValueError("unsupported path command " + command)
        out.append(command + " ".join(f"{v:.5f}" for v in values))

    for token in tokens:
        if re.fullmatch(r"[A-Za-z]", token):
            flush()
            command = token
            numbers = []
        else:
            numbers.append(float(token))
    flush()
    return "".join(out)


def start_point(d: str) -> tuple[float, float]:
    match = re.match(r"\s*[Mm]\s*(" + NUMBER + r")[\s,]*(" + NUMBER + ")", d)
    return float(match.group(1)), float(match.group(2))


def main():
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    text = SYMBOLS_FILE.read_text()
    root = ET.fromstring(text)
    defs = root.find("{%s}defs" % SVG_NS)
    symbols = {symbol.get("id"): symbol for symbol in defs.findall("{%s}symbol" % SVG_NS)}

    entries = []  # (tikz name, options, symbol id, mid)
    for component in root.iter("{%s}component" % SVG_NS):
        if component.get("group") != "Transistors" or component.get("type") != "node":
            continue
        for variant in component.findall("{%s}variant" % SVG_NS):
            options = ", ".join(option.get("name") for option in variant.findall("{%s}option" % SVG_NS))
            mid = (float(variant.get("x", 0)), float(variant.get("y", 0)))
            entries.append((component.get("tikz"), options, variant.get("for"), mid))

    print(f"rendering {len(entries)} transistor variants...")
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        render_entries = [(tikz, options) for tikz, options, _, _ in entries]
        legacy_pages = render(render_entries, "legacy", workdir)
        end_pages = render(render_entries, "end", workdir)

    # dvisvgm uses the TeX origin, which lies 1in (72bp) right of and below the top left page corner
    origin = (HALF_BOX_CM * CM_TO_BP - 72, HALF_BOX_CM * CM_TO_BP - 72)
    generated = []
    unmatched = []
    for (tikz, options, symbol_id, mid), legacy_page, end_page in zip(entries, legacy_pages, end_pages):
        legacy_paths = drawn_paths(legacy_page)
        end_paths = drawn_paths(end_page)
        legacy_keys = {path_key(p) for p in legacy_paths}
        end_keys = {path_key(p) for p in end_paths}
        removed = [p for p in legacy_paths if path_key(p) not in end_keys]
        added = [p for p in end_paths if path_key(p) not in legacy_keys]
        if not removed and not added:
            continue

        original = symbols[symbol_id]
        new_symbol = copy.deepcopy(original)
        new_symbol.set("id", symbol_id + SUFFIX)

        # find the elements of the original symbol which correspond to the removed arrow paths
        removed_starts = {
            start_point(transform_path(p.get("d"), origin, mid)) for p in removed if p.get("d")
        }
        matched_elements = []
        for parent in new_symbol.iter():
            for child in list(parent):
                if child.tag != "{%s}path" % SVG_NS or not child.get("d"):
                    continue
                sx, sy = start_point(child.get("d"))
                if any(abs(sx - x) < MATCH_TOLERANCE and abs(sy - y) < MATCH_TOLERANCE for x, y in removed_starts):
                    matched_elements.append((parent, child))
        if not matched_elements:
            unmatched.append(f"{symbol_id} ({tikz}, {options})")
            continue

        # replace the first matched element with the new arrow paths (keeping its attributes for theming), remove the rest
        template_parent, template = matched_elements[0]
        insert_index = list(template_parent).index(template)
        for parent, child in matched_elements:
            parent.remove(child)
        for offset, path in enumerate(added):
            new_element = copy.deepcopy(template)
            new_element.set("d", transform_path(path.get("d"), origin, mid))
            if path.get("stroke") is None:
                new_element.set("stroke", "none")
            if path.get("fill") == "none":
                new_element.set("fill", "none")
            if path.get("stroke-width") is not None:
                new_element.set("stroke-width", f"{float(path.get('stroke-width')) * BP_TO_PX:.5f}")
            template_parent.insert(insert_index + offset, new_element)
        generated.append(new_symbol)

    if unmatched:
        print("could not locate the arrow in these symbols, they keep the legacy arrow:", file=sys.stderr)
        for entry in unmatched:
            print("  " + entry, file=sys.stderr)

    # write the generated symbols as text, so the rest of the (generated) file stays untouched
    text = re.sub(r'\n\t\t<symbol id="[^"]*' + SUFFIX + r'">.*?</symbol>', "", text, flags=re.S)
    serialized = []
    for symbol in generated:
        symbol_text = ET.tostring(symbol, encoding="unicode", short_empty_elements=True)
        symbol_text = symbol_text.replace(' xmlns="%s"' % SVG_NS, "")
        serialized.append("\n\t\t" + symbol_text.strip())
    defs_end = text.index("</defs>")
    insert_at = text.rindex("\n", 0, defs_end)
    text = text[:insert_at] + "".join(serialized) + text[insert_at:]
    SYMBOLS_FILE.write_text(text)
    print(f"generated {len(generated)} symbols with arrow pos=end, {len(unmatched)} unmatched")


if __name__ == "__main__":
    main()
