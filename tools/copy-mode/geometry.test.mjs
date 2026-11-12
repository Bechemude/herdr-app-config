import assert from "node:assert/strict";
import { paneRects, shares, gridRect } from "../../mods/vim-copy/geometry.js";

const leaf = (id, terminal = id) => ({ id, type: "block", content: { terminal } });
const tab = { id: "tab", type: "row", children: [leaf("a"), { id: "right", type: "column", children: [leaf("b"), leaf("c")] }] };
const pane = { gap: 8, lone: true, border: { width: 1 }, header: { height: 30, position: "top" } };
const chrome = { id: "root", type: "row", divider: { width: 1 }, children: [
  { id: "sidebar", type: "block", size: { px: 200 }, content: { mod: "spaces" } },
  { id: "main", type: "block", content: { tab: "active", pane } },
] };
const g = paneRects(chrome, { width: 1201, height: 800 }, tab);
assert.deepEqual(g.panes.map(p => p.rect), [
  { x: 202, y: 31, width: 494, height: 768 },
  { x: 706, y: 31, width: 494, height: 364 },
  { x: 706, y: 435, width: 494, height: 364 },
]);
assert.equal(paneRects(chrome, { width: 1201, height: 800 }, tab, 1, "c").panes.length, 1);
assert.deepEqual(paneRects(chrome, { width: 1201, height: 800 }, tab, 1, "c").panes[0].rect,
  { x: 202, y: 31, width: 998, height: 768 });
assert.deepEqual(shares([{ size: { px: 100 } }, {}, {}], 500), [100, 200, 200]);
assert.deepEqual(shares([{ max: 100 }, {}, {}], 600), [100, 200, 200]);
assert.deepEqual(shares([{ min: 300 }, {}], 500), [300, 200]);
const scaled = paneRects(chrome, { width: 2402, height: 1600 }, tab, 2);
assert.deepEqual(scaled.panes.map(p => p.rect), g.panes.map(p => Object.fromEntries(Object.entries(p.rect).map(([k, v]) => [k, v * 2]))));
assert.deepEqual(gridRect({ x: 20, y: 40, width: 200, height: 120 }, 20, 5, { width: 8, height: 18 }, [10, 10]),
  { x: 30, y: 55, width: 160, height: 90 });
console.log("PASS: nested panes, frame/header/gap, zoom, fixed sizes, min/max shares, cell origin");
