import assert from "node:assert/strict";
import { gridRect } from "../../mods/vim-copy/geometry.js";
import { app, command, openMode, split, withFixture, png, pause } from "./test_support.mjs";

// Brandbook's layout: one tall pane beside three panes weighted 1, .5, .5.
// Compare the actual colored glyph pixels with their calculated selection cells.
await withFixture(async ({ made, liveFile }) => {
  const right = await split("right", null, "TOP RIGHT PANE", liveFile);
  const middle = await split("down", right.pane, "MIDDLE RIGHT PANE", liveFile);
  const bottom = await split("down", middle.pane, "BOTTOM RIGHT PANE", liveFile);
  command("layout.resize", { id: right.pane, weight: 1 });
  command("layout.resize", { id: middle.pane, weight: .5 });
  command("layout.resize", { id: bottom.pane, weight: .5 });
  await pause(600);
  app("shot", "/tmp/herdr-copy-four-before.png");
  const image = png("/tmp/herdr-copy-four-before.png");
  const data = await openMode(made.tab);
  assert.equal(data.geometry.panes.length, 4);
  const scale = data.snapshot.scale;
  const cell = { width: 14 * .6, height: Math.ceil(14 * 1.32 * 1.15 * scale) / scale };
  const red = (x, y) => {
    const at = y * image.stride + x * image.channels;
    const [r, g, b] = image.pixels.subarray(at, at + 3);
    return r > 150 && r > g * 1.4 && r > b * 1.2;
  };
  const failures = [];
  let baseline;
  for (const p of data.geometry.panes) {
    const meta = data.snapshot.panes.find(m => m.pane === p.pane);
    const grid = gridRect(p.rect, meta.cols, meta.rows, cell, [14, 12], 1, scale);
    const expected = { x: grid.x * scale, y: (grid.y + 2 * cell.height) * scale,
      width: 25 * cell.width * scale, height: cell.height * scale };
    let inside = 0, outside = 0, minY = Infinity, maxY = 0;
    // Search within the predicted body, independent of the predicted text row.
    for (let y = Math.ceil(p.rect.y * scale); y < (p.rect.y + p.rect.height) * scale; y++) {
      for (let x = Math.ceil(grid.x * scale); x < (grid.x + 25 * cell.width) * scale; x++) {
        if (!red(x, y)) continue;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (y >= expected.y && y < expected.y + expected.height) inside++;
        else outside++;
      }
    }
    const result = { terminal: p.terminal, rows: meta.rows, expectedY: expected.y,
      actualY: [minY, maxY], inside, outside, body: p.rect };
    console.log(JSON.stringify(result));
    const offset = minY - expected.y;
    baseline ??= offset;
    if (!inside || outside > inside * .01 || Math.abs(offset - baseline) > 1) failures.push(result);
  }
  assert.deepEqual(failures, [], "Selection cells do not contain their native text glyphs");
  console.log("PASS: four-pane native glyphs align with selection cells");
});
