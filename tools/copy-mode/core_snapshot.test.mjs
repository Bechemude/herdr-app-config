import assert from "node:assert/strict";
import { terminalPanes, screenRows } from "../../mods/vim-copy/core_snapshot.mjs";
const call = (method, ...args) => ({ terminal_panes: terminalPanes, screen_rows: screenRows })[method](...args);
const leaf = id => ({ id, type: "block", content: { terminal: id } });
const tree = { type: "row", children: [leaf("a"), { type: "column", children: [leaf("b"), leaf("c")] }] };
assert.deepEqual(call("terminal_panes", tree).map(p => p.terminal), ["a", "b", "c"]);
assert.deepEqual(call("terminal_panes", tree, "b").map(p => p.terminal), ["b"]);
assert.deepEqual(call("terminal_panes", { ...tree, hidden: true }), []);
assert.deepEqual(call("terminal_panes", { type: "block", content: { mod: "files" } }), []);
assert.deepEqual(call("terminal_panes", { type: "stack", active: "c", children: [leaf("a"), leaf("c")] }).map(p => p.terminal), ["c"]);
assert.deepEqual(call("screen_rows", "a界e\u0301", 6, 2), [
  [{ text: "a", col: 0, width: 1 }, { text: "界", col: 1, width: 2 }, { text: "e\u0301", col: 3, width: 1 }], [],
]);
assert.deepEqual(call("screen_rows", "abcdef", 3, 2).map(row => row.map(g => g.text).join("")), ["abc", "def"]);
assert.deepEqual(screenRows("👩‍💻 café 👋🏽", 20, 1)[0].map(g => [g.text, g.col, g.width]), [
  ["👩‍💻", 0, 2], [" ", 2, 1], ["c", 3, 1], ["a", 4, 1], ["f", 5, 1], ["é", 6, 1], [" ", 7, 1], ["👋🏽", 8, 2],
]);
assert.equal(screenRows("a\tb", 12, 1)[0].at(-1).col, 8);
assert.deepEqual(screenRows("🇬🇧x", 4, 1)[0].map(g => [g.col, g.width]), [[0, 2], [2, 1]]);
assert.throws(() => screenRows("a", undefined, undefined), /dimensions/);
console.log("PASS: core helper nested panes, zoom, hidden/mod/stack nodes, combining marks, wide glyphs, wrapped rows");
