import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { gridRect } from "../../mods/vim-copy/geometry.js";
import { app, key, openMode, closeMode, state, copyText, split, withFixture, png, region, pause } from "./test_support.mjs";

await withFixture(async ({ made, liveFile, clipboard }) => {
  const right = await split("right", null, "TOP RIGHT PANE", liveFile);
  await split("down", right.pane, "BOTTOM RIGHT PANE", liveFile);
  // Core document changes can precede native layout/terminal resize. Wait for
  // actual grid dimensions, since `shot` otherwise returns an older frame.
  await openMode(made.tab);
  await state(d => d.geometry.panes.every(p => {
    const m = d.snapshot.panes.find(m => m.pane === p.pane);
    const height = Math.ceil(14 * 1.32 * 1.15 * d.snapshot.scale) / d.snapshot.scale;
    return m.cols === Math.floor((p.rect.width - 28) / 8.4) && m.rows === Math.floor((p.rect.height - 24) / height);
  }));
  await closeMode();
  app("shot", "/tmp/herdr-copy-transparent-before.png");
  let data = await openMode(made.tab);
  assert.equal(data.geometry.panes.length, 3);
  app("shot", "/tmp/herdr-copy-transparent-after.png");
  const before = png("/tmp/herdr-copy-transparent-before.png"), after = png("/tmp/herdr-copy-transparent-after.png");
  const scale = data.snapshot.scale;
  assert.equal(before.width, after.width);
  const p = data.geometry.panes[0], meta = data.snapshot.panes.find(m => m.pane === p.pane);
  const cell = { width: 14 * 0.6, height: Math.ceil(14 * 1.32 * 1.15 * scale) / scale };
  const grid = gridRect(p.rect, meta.cols, meta.rows, cell, [14, 12], 1, scale);
  const sample = { x: grid.x * scale, y: (grid.y + 2 * cell.height) * scale, width: 30 * cell.width * scale, height: cell.height * scale };
  const original = region(before, sample), overlay = region(after, sample);
  let red = false;
  for (let at = 0; at < original.length; at += before.channels) if (original[at] > 150 && original[at] > original[at + 1] * 1.4 && original[at] > original[at + 2] * 1.2) red = true;
  assert(red, "The pixel sample must contain the fixture's colored terminal text");
  const background = pixels => {
    const counts = new Map();
    for (let at = 0; at < pixels.length; at += before.channels) {
      const color = [...pixels.subarray(at, at + 3)].join(",");
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  };
  const base = background(original), tinted = background(overlay), transmission = 1 - 26 / 255;
  let wrong = 0;
  for (let at = 0; at < original.length; at += before.channels) {
    for (let channel = 0; channel < 3; channel++) {
      const expected = tinted[channel] + (original[at + channel] - base[channel]) * transmission;
      if (Math.abs(overlay[at + channel] - expected) > 2) wrong++;
    }
  }
  assert(!original.equals(overlay), "The layer should add a visible 10% tint");
  assert(wrong < original.length * .01, "Original colored glyphs must remain visible through a 90% transparent tint");
  console.log("PASS: original colored glyphs remain visible through a 90% transparent tint");

  await key("jump"); await key("type-alpha");
  data = await state(d => d.query === "alpha" && d.labels?.length >= 6);
  assert.equal(new Set(data.labels.map(m => m.pane)).size, 3);
  app("shot", "/tmp/herdr-copy-jump.png");
  await key("type-" + data.labels[0].label);
  data = await state(d => d.mode === "normal");
  assert.equal(data.selected, data.snapshot.panes[0].pane);
  await key("select"); await key("end");
  await state(d => d.selection?.[0]?.width === 5);
  app("shot", "/tmp/herdr-copy-selection.png");
  if (clipboard.length) {
    await copyText("alpha"); console.log("PASS: native clipboard character copy");
    await openMode(made.tab);
  } else await key("escape");
  await key("search"); await key("type-Select this exact text."); await key("enter"); await key("line");
  await state(d => d.selection?.[0]?.width === 23);
  if (clipboard.length) {
    await copyText("Select this exact text.\n"); console.log("PASS: native clipboard line copy");
    await openMode(made.tab);
  } else await key("escape");
  await key("search"); await key("type-世界"); await key("enter"); await key("select"); await key("right");
  await state(d => d.selection?.[0]?.width === 4);
  if (clipboard.length) {
    await copyText("世界"); console.log("PASS: wide Unicode selection and native clipboard copy");
    await openMode(made.tab);
  } else await key("escape");
  await key("search"); await key("type-one two three four"); await key("enter"); await key("line");
  writeFileSync(liveFile, "LIVE replacement line");
  await pause(350);
  if (clipboard.length) {
    await copyText("LIVE replacement line\n");
    console.log("PASS: copy reads fresh terminal output instead of stale selection text");
    await openMode(made.tab);
  } else await key("escape");
  await key("jump"); await key("type-replacement");
  await state(d => d.query === "replacement" && new Set(d.labels?.map(m => m.pane)).size === 3);
  console.log("PASS: live text refresh, cross-pane labels, jumps, character/line selection");
});
