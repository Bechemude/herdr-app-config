import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
export function app(...args) {
  const out = execFileSync("herdr-app", args, { encoding: "utf8", timeout: 15000 }).trim();
  return out.startsWith("{") ? JSON.parse(out) : out;
}
export const command = (name, args = {}) => app("do", name, JSON.stringify(args));
export const readJSON = path => JSON.parse(readFileSync(path, "utf8"));
export async function waitFor(read, predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = read(); if (predicate(value)) return value; } catch {}
    await pause(100);
  }
  throw new Error("Timed out: " + label);
}
export const state = predicate => waitFor(() => readJSON(root + "data/vim-copy-debug.json"), predicate, "copy-mode state");
export async function key(name) { command("vim-copy." + name); await pause(120); }
export async function openMode(tab, outlines = false) {
  const started = Date.now();
  command("mod.open", { name: "vim-copy" });
  await key(outlines ? "outline" : "debug");
  return state(d => d.created >= started && d.snapshot?.tab === tab && d.cursor && d.geometry?.panes.length);
}
export async function closeMode() {
  if (app("status").overlays.includes("vim-copy")) command("mod.open", { name: "vim-copy" });
  await pause();
}
export async function copyText(expected) {
  await key("copy");
  await waitFor(() => app("status"), s => !s.overlays.includes("vim-copy"), "copy and exit");
  const copied = execFileSync("pbpaste");
  assert.equal(copied.toString("utf8"), expected);
}
export function fixture(name, liveFile) {
  const lines = [name, "", "\x1b[38;2;240;70;90malpha bravo charlie delta\x1b[0m", "one two three four",
    "Search alpha and jump between panes.", "Select this exact text.", "Unicode: café Привет 世界", "", "COPY MODE GEOMETRY TEST"];
  const source = `const fs = require("node:fs"); process.stdout.write(${JSON.stringify(lines.join("\n") + "\n")});
    fs.watchFile(${JSON.stringify(liveFile)}, {interval:100}, () => {
      try { const text = fs.readFileSync(${JSON.stringify(liveFile)}, "utf8");
        process.stdout.write("\\x1b[4;1H" + text + "\\x1b[K\\x1b[11;1H"); } catch {}
    }); setInterval(() => {}, 1000);`;
  return ["node", "-e", source];
}
export async function withFixture(test) {
  const initial = app("status");
  const clipboard = execFileSync("pbpaste");
  const liveFile = `/tmp/herdr-copy-live-${process.pid}.txt`;
  writeFileSync(liveFile, "");
  await closeMode();
  const made = command("tab.new", { name: "copy-mode-test", argv: fixture("LEFT PANE", liveFile) });
  await pause(500);
  try { await test({ initial, made, liveFile, clipboard }); }
  finally {
    await closeMode();
    command("tab.close", { id: made.tab, confirmed: true });
    command("tab.select", { id: initial.tab });
    if (clipboard.length) execFileSync("pbcopy", [], { input: clipboard });
    if (existsSync(liveFile)) unlinkSync(liveFile);
    console.log("Restored original tab; preserved clipboard");
  }
}
export async function split(direction, pane, title, liveFile) {
  const made = command("pane.split", { direction, ...(pane ? { pane } : {}), argv: fixture(title, liveFile) });
  await pause(500);
  return made;
}

// Native app screenshots are non-interlaced 8-bit RGB/RGBA PNGs. Decode them
// with Node's standard library so the transparency check needs no image package.
export function png(path) {
  const file = readFileSync(path), chunks = [];
  assert.equal(file.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = file.readUInt32BE(16), height = file.readUInt32BE(20), depth = file[24], color = file[25];
  assert.equal(depth, 8); assert([2, 6].includes(color)); assert.equal(file[28], 0);
  const channels = color === 6 ? 4 : 3;
  for (let at = 8; at < file.length;) {
    const size = file.readUInt32BE(at), type = file.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + size));
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0;
      const b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels, stride };
}
export function region(image, rect) {
  const x = Math.round(rect.x), y = Math.round(rect.y), width = Math.round(rect.width), height = Math.round(rect.height);
  assert(x >= 0 && y >= 0 && x + width <= image.width && y + height <= image.height);
  const rows = [];
  for (let row = y; row < y + height; row++) rows.push(image.pixels.subarray(row * image.stride + x * image.channels, row * image.stride + (x + width) * image.channels));
  return Buffer.concat(rows);
}
