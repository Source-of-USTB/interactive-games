# Noto Sans SC UI font

NotoSansSC-Regular is a subset of the Simplified Chinese face (index 2) of
Noto Sans CJK Regular, version 2.004. Source: the system-provided
`/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc`, from the Noto CJK project.

Copyright © 2014–2021 Adobe. Distributed under the SIL Open Font License 1.1;
see LICENSE-NotoSansSC.txt. This font remains under OFL when bundled with the game.

The subset preserves all available GB2312 characters (including its 6,763 Han
characters), basic/extended Latin, general punctuation, common arrows and
mathematical/technical/geometric symbols, CJK radicals and punctuation, and
fullwidth forms. It also includes supported characters found in the current
Web, Godot, and shared game-core source. This broad character repertoire supports
new Chinese UI text rather than only existing phrases. Rare characters outside
this repertoire should use a system fallback font or prompt regenerating the
subset. The source font itself does not contain ↶ or ↷; draw those controls as
icons or use a fallback that supplies those glyphs.

The native Godot file uses the original CFF OpenType outlines (`.otf`). The Web
file is the same font compressed to WOFF2. The subset was generated with
fontTools 4.64.0, retaining all name entries and languages, and the horizontal UI layout features
`kern`, `liga`, `clig`, `calt`, `ccmp`, `mark`, and `mkmk`. The SC face
default glyphs are preserved; unused vertical and other regional alternates
are removed to reduce download size;
WOFF2 compression used the system `woff2_compress` utility.
