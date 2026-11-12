// Runs under Bun or Node; the native mod UI has its own JavaScript engine.
import { spawn, execFile } from "node:child_process";
import { readFile, open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isWide } from "./unicode_width.js";

const execute = promisify(execFile);
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class Core {
  constructor() {
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = "";
    this.process = spawn("hc", ["connect"], { stdio: ["pipe", "pipe", "ignore"] });
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", chunk => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          const reply = JSON.parse(line), request = this.pending.get(reply.id);
          if (!request) continue;
          this.pending.delete(reply.id);
          clearTimeout(request.timer);
          if (reply.error) request.reject(new Error(JSON.stringify(reply.error)));
          else request.resolve(reply.result);
        } catch (error) { this.fail(error); }
      }
    });
    this.process.on("error", error => this.fail(error));
    this.process.stdin.on("error", error => this.fail(error));
    this.process.on("close", () => this.fail(new Error("Core closed its connection")));
  }

  fail(error) {
    this.error = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  call(method, params) {
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out reading " + method));
      }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  close() {
    this.fail(new Error("Core reader closed"));
    this.process.stdin.end();
    this.process.kill(); // Only our `hc connect` client, never herdr-core.
  }
}

export function terminalPanes(node, zoomed = null) {
  if (node.hidden) return [];
  let children = (node.children ?? []).filter(child => !child.hidden);
  if (node.type === "stack") children = [children.find(child => child.id === node.active) ?? children[0]].filter(Boolean);
  const leaves = children.flatMap(child => terminalPanes(child, zoomed));
  const terminal = node.content?.terminal;
  if (terminal && (!zoomed || node.id === zoomed)) leaves.push({ pane: node.id, terminal });
  return leaves;
}

export function screenRows(text, cols, rows) {
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) throw new Error("Terminal has no grid dimensions");
  const output = [];
  for (const line of text.split("\n")) {
    let glyphs = [], column = 0;
    const add = (text, width) => {
      if (column + width > cols) { output.push(glyphs); glyphs = []; column = 0; }
      glyphs.push({ text, col: column, width });
      column += width;
    };
    for (const { segment } of graphemes.segment(line.replace(/\r+$/, ""))) {
      if (segment === "\t") {
        const count = 8 - column % 8;
        for (let i = 0; i < count; i++) add(" ", 1);
      } else if (segment.codePointAt(0) >= 32 && segment !== "\x7f") {
        const points = [...segment].map(char => char.codePointAt(0));
        const flag = points.length === 2 && points.every(point => point >= 0x1f1e6 && point <= 0x1f1ff);
        add(segment, flag || points.some(isWide) ? 2 : 1);
      }
    }
    output.push(glyphs);
  }
  return Array.from({ length: rows }, (_, i) => output[i] ?? []);
}

export async function snapshot(appHome, withText = false, viewportWidth = null) {
  const readView = async () => JSON.parse(await readFile(join(appHome, "view.json"), "utf8"));
  const view = await readView(), space = view.active, tabId = view.spaces?.[space];
  if (!space || !tabId) throw new Error("No active tab");
  if (space.includes("/")) throw new Error("Copy mode currently supports local spaces only");
  const core = new Core();
  let doc, panes, tab;
  const zoomed = view.tabs?.[tabId]?.zoomed ?? null;
  try {
    const results = await Promise.all([core.call("doc.get", { name: "herdr-app" }), core.call("terminal.list", {})]);
    doc = results[0];
    const grids = new Map(results[1].terminals.map(t => [t.address, t]));
    tab = doc.value?.spaces.find(s => s.id === space)?.tabs.find(t => t.id === tabId);
    if (!tab) throw new Error("The active tab is absent from the core layout document");
    panes = await Promise.all(terminalPanes(tab.root, zoomed).map(async pane => {
      const { cols, rows } = grids.get(pane.terminal) ?? {};
      const result = { ...pane, cols, rows };
      if (withText) {
        // Zero history avoids scrolling or sending input to a full-screen app.
        const read = await core.call("terminal.read", { terminal: pane.terminal, lines: 0 });
        result.screen = screenRows(read.text, cols, rows);
        result.complete = read.complete;
      }
      return result;
    }));
  } finally { core.close(); }
  const latest = await readView();
  if (["active", "spaces", "tabs"].some(key => JSON.stringify(view[key]) !== JSON.stringify(latest[key]))) {
    throw new Error("The visible tab changed while reading; try again");
  }
  let scale = null;
  if (withText && viewportWidth) {
    const folder = await mkdtemp(join(tmpdir(), "vim-copy-"));
    try {
      const shot = join(folder, "window.png");
      await execute("herdr-app", ["shot", shot], { timeout: 5000 });
      const file = await open(shot, "r"), image = Buffer.alloc(24);
      try { await file.read(image, 0, image.length, 0); }
      finally { await file.close(); }
      if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Herdr returned an invalid PNG");
      scale = image.readUInt32BE(16) / viewportWidth;
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  return { space, tab: tabId, zoomed, scale, document_version: doc.version, panes,
    split_tree: tab.root, pixel_positions: null, scroll_offsets: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
    const home = option("--app-home") ?? fileURLToPath(new URL("../../", import.meta.url));
    console.log(JSON.stringify(await snapshot(home, args.includes("--text"), Number(option("--viewport-width")) || null)));
  } catch (error) {
    console.error("core snapshot: " + error.message);
    process.exitCode = 1;
  }
}
