import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { app, command, openMode, closeMode, split, withFixture, pause } from "./test_support.mjs";

await withFixture(async ({ made, liveFile }) => {
  async function capture(name, count, zoomed = null) {
    const data = await openMode(made.tab, true);
    assert.equal(data.geometry.panes.length, count);
    assert.equal(data.snapshot.zoomed, zoomed);
    for (const { rect } of data.geometry.panes) {
      assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
      assert(rect.x + rect.width <= data.size.width && rect.y + rect.height <= data.size.height);
    }
    writeFileSync(`/tmp/herdr-copy-${name}.json`, JSON.stringify(data, null, 2));
    app("shot", `/tmp/herdr-copy-${name}.png`);
    await closeMode();
  }
  await capture("one", 1);
  const right = await split("right", null, "TOP RIGHT PANE", liveFile);
  await capture("two", 2);
  const lower = await split("down", right.pane, "BOTTOM RIGHT PANE", liveFile);
  await capture("three", 3);
  command("pane.zoom", { pane: lower.pane }); await pause();
  await capture("zoomed", 1, lower.pane);
  console.log("PASS: live one/two/three-pane positions and pane zoom");
});
