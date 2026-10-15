# /// script
# dependencies = ["fonttools", "skia-pathops"]
# ///
"""Build resources/commit-generater-icons.woff from resources/icon-dark.svg.

VS Code status bar text only supports `$(icon-id)` icons, so the SVG used by
the SCM title button is converted into an icon font and contributed through
`contributes.icons` in package.json.

Run: uv run --no-project scripts/build_icon_font.py
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
SVG_FILE = ROOT / "resources" / "icon-dark.svg"
OUT_FILE = ROOT / "resources" / "commit-generater-icons.woff"

# Same metrics as VS Code's codicon font: 300 units per em, glyph box 0..300.
UPM = 300
GLYPH_CODEPOINT = 0xE001
GLYPH_NAME = "commit-generater-icon"

svg = ET.parse(SVG_FILE).getroot()
view_box = [float(v) for v in svg.attrib["viewBox"].split()]
scale = UPM / view_box[3]

outline = pathops.Path()
for element in svg.iter():
    if not element.tag.endswith("path"):
        continue
    centerline = pathops.Path()
    # Map SVG user space (y down) to font space (y up).
    parse_path(element.attrib["d"], TransformPen(centerline.getPen(), (scale, 0, 0, -scale, -view_box[0] * scale, UPM + view_box[1] * scale)))
    stroke_width = float(element.attrib.get("stroke-width", "1")) * scale
    centerline.stroke(stroke_width, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    # Round caps/joins produce conic segments, which fonts cannot store.
    centerline.convertConicsToQuads()
    outline = pathops.op(outline, centerline, pathops.PathOp.UNION)

outline.simplify()

pen = T2CharStringPen(UPM, None)
outline.draw(pen)
char_string = pen.getCharString()
empty_pen = T2CharStringPen(UPM, None)
empty_pen.endPath()

fb = FontBuilder(UPM, isTTF=False)
fb.setupGlyphOrder([".notdef", GLYPH_NAME])
fb.setupCharacterMap({GLYPH_CODEPOINT: GLYPH_NAME})
fb.setupCFF("CommitGeneraterIcons", {"FullName": "Commit Generater Icons"}, {".notdef": empty_pen.getCharString(), GLYPH_NAME: char_string}, {})
fb.setupHorizontalMetrics({".notdef": (UPM, 0), GLYPH_NAME: (UPM, 0)})
fb.setupHorizontalHeader(ascent=UPM, descent=0)
fb.setupNameTable({"familyName": "Commit Generater Icons", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, sTypoLineGap=0, usWinAscent=UPM, usWinDescent=0)
fb.setupPost()
fb.font.flavor = "woff"
fb.save(OUT_FILE)
print(f"Wrote {OUT_FILE.relative_to(ROOT)} (U+{GLYPH_CODEPOINT:04X})")
