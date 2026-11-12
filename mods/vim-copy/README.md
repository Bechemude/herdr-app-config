# Vim copy mode

Press **Cmd-Shift-C** to navigate and select text across the terminal panes
visible in the current tab. Pane positions come from the live layout and
herdr-core's split tree. The app executable and shipped layouts are unchanged.

The layer covers the existing pane positions with a light background tint
(90% transparent). It draws the copy cursor, translucent selection/search
highlights, jump labels and a small header hint. Herdr renders the original live text, colors, images and links;
the mod never paints a replacement terminal body or text view.

| Key                      | Action                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| `h j k l`, arrows        | Move the copy cursor                                                    |
| `w b e`, `W B E`         | Word motions                                                            |
| `0`, `^`, `$`            | Start, first non-space, end of line                                     |
| `g`, `G`                 | Top screen row / last nonempty screen row                               |
| `Ctrl-U/D`, Page Up/Down | Move by half/full screen                                                |
| `v`, Space               | Character selection                                                     |
| `V`                      | Whole-line selection                                                    |
| `s`, then text           | Flash-style jump labels after two characters                            |
| `/`, then text, Enter    | Search and move to a match                                              |
| `n`, `N`                 | Repeat search forward/backward                                          |
| Tab, Shift-Tab           | Select another visible pane                                             |
| `y`, Enter, Cmd-C        | Copy the selection and exit; without a selection, copy the current line |
| Escape                   | Cancel search/selection, then exit                                      |
| `q`, Cmd-Shift-C         | Exit immediately                                                        |
| `r`                      | Refresh terminal text and reset selections                              |

Jump labels are unique across the visible panes and exclude immediate query
continuations. Longer labels are used when needed. A jump inside the same pane
extends a visual selection. Moving to another pane clears the previous selection.

Splits, pane moves, zoom and viewport resizing are recalculated while the layer
is open. Live text is read every 750 ms and refreshed again before copying.
Selections keep their screen coordinates when text changes; copied text comes
from the latest core read. Changed dimensions reset that pane's selection.
Hidden panes and other tabs are excluded.

## Current limits

- Local spaces and the current core screens only. Existing app scrollback offsets
  are unavailable, so entering the mode reads the live core screens even if the
  app was showing older scrollback. History navigation is not implemented.
- Terminal output stays live. Highlights and search matches can lag the output
  by up to one refresh interval. Copying reads the text again before writing it
  to the clipboard. The overlay captures mouse input while the mode is open.
- Character metrics are matched to Herdr **0.1.14**, **JetBrains Mono**. Display
  scale is detected from a temporary app screenshot. Other fonts and app versions
  need separate alignment verification.
- The active tab's normal terminal panes are supported. Terminal blocks in custom
  composition layouts or separate floating terminal windows are not yet included.
- Selection is within one terminal. Unicode combining marks and wide characters
  are handled, but complex emoji sequences may need further verification.

## Access and checks

Requires `bun`, `hc` and `herdr-app` on PATH, with no extra packages.
Both the native mod and the external helper are JavaScript. The native UI runs
inside Herdr; Bun starts the helper on entry, on each 750 ms refresh and before
copying. The helper can also run with Node. It reads app focus state and core layout/screen data. It never
attaches, resizes terminals, sends keys to programs or reaches the network. A
temporary screenshot is used only for its PNG dimensions and removed immediately.
Terminal buffers live only in memory. Clipboard writing uses GPUI's native API
when the person copies. Optional diagnostics are enabled by `vim-copy.debug` and
save geometry/cursor/query metadata to `data/vim-copy-debug.json`, without buffers.

Tests and assertions are JavaScript and use Node's standard library. There is
no Python runtime dependency.

Verified with native `herdr-app check`, one/two/three/four-pane and zoomed layouts,
rendered screenshots and in-app command dispatch. The four-pane alignment check
uses brandbook's unequal split proportions. It verifies that native colored
glyphs lie within their selection rows, with the same baseline across panes.
Pixel comparison checks that the original colored terminal glyphs remain visible
through the 90% transparent tint. Clipboard
assertions cover characters, whole lines, wide Unicode and new terminal output.
The scripts restore the original tab and text clipboard. Physical keyboard
automation was unavailable. Clipboard checks skip image-only clipboards.

Runnable checks from the app home:

```sh
herdr-app check mods/vim-copy
node tools/copy-mode/core_snapshot.test.mjs
node tools/copy-mode/geometry.test.mjs
node tools/copy-mode/buffer.test.mjs
node tools/copy-mode/geometry_smoke.mjs
node tools/copy-mode/alignment_smoke.mjs
node tools/copy-mode/copy_smoke.mjs
```

The smoke scripts create and remove their own test tab and restore the original
tab. The copy script restores an existing text clipboard after its copy assertions.
