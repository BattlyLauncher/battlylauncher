# Android emoji font

`NotoColorEmoji.ttf` is the unmodified color emoji font from Google's Noto Emoji project, downloaded on 2026-10-06:

https://github.com/googlefonts/noto-emoji/blob/main/2D/fonts/NotoColorEmoji.ttf

Copyright Google LLC. Licensed under the SIL Open Font License 1.1. The license is included here and copied into the packaged renderer at `licenses/NotoEmoji-OFL.txt` via Vite's public directory.

The `Battly Emoji` CSS face covers emoji codepoints before ordinary text faces. `Battly Emoji Sequences` is a full fallback after the text faces, allowing keycap clusters to shape without replacing ordinary digits. Both faces load the same local font resource.
