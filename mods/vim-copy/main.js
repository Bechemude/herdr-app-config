import { View, div } from "gpui-kit";
import { appHome, exec, focused, layout, settings, props, closeOverlay, theme, run, nextCommand, readTextFile, writeTextFile } from "herdr";
import { paneRects, gridRect } from "./geometry.js";
import { Buffer, matches, labelMatches } from "./buffer.js";

const signature = s => JSON.stringify([s.tab, s.zoomed, s.split_tree, s.panes.map(p => [p.pane, p.terminal, p.cols, p.rows])]);
export default class VimCopy extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.created = Date.now();
    this.back = focused()?.terminal;
    this.size = window.viewport_size();
    this.snapshot = null;
    this.buffers = new Map();
    this.selected = null;
    this.error = null;
    this.mode = "normal";
    this.query = "";
    this.lastQuery = "";
    this.labelInput = "";
    this.count = "";
    this.loading = false;
    this.closed = false;
    this.debug = false;
    this.outlines = false;
    this.widthRatio = 0.6;
    this.load(cx, true);
    // Read live text as well as structure while the transparent layer is open.
    // Notify only when something changes; the terminal paints its own text.
    cx.timer.every(750, cx => this.load(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "debug") { this.debug = !this.debug; this.dump(cx); cx.notify(); }
        else if (command === "outline") { this.outlines = !this.outlines; this.debug = true; this.dump(cx); cx.notify(); }
        else if (command === "close") this.leave();
        else if (command.startsWith("type-")) {
          for (const key of command.slice(5)) this.key({ key, key_char: key, keystroke: key, modifiers: {} }, cx);
        } else {
          const keys = { jump: "s", search: "/", select: "v", line: "V", copy: "y", next: "tab", left: "h", right: "l", down: "j", up: "k", word: "w", end: "e", escape: "escape", enter: "enter", home: "0", "half-down": "ctrl-d", "half-up": "ctrl-u", "page-down": "pagedown", "page-up": "pageup" };
          if (command === "choose-first") { const m = this.labels()[0]; if (m) this.jump(m); }
          else if (keys[command]) this.key({ key: keys[command], key_char: keys[command], keystroke: keys[command], modifiers: {} }, cx);
          this.dump(cx); cx.notify();
        }
      }
    });
  }

  async read(withScale = false) {
    const args = [appHome() + "/mods/vim-copy/core_snapshot.mjs", "--app-home", appHome(), "--text"];
    if (withScale) args.push("--viewport-width", String(this.size.width));
    const result = await exec("bun", args, { timeout: 10000 });
    if (result.code) throw new Error(result.stderr.trim());
    return JSON.parse(result.stdout);
  }

  load(cx, refresh = false) {
    if (this.loading || this.closed) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const next = await this.read(!this.snapshot || this.scaleWidth !== this.size.width);
        if (this.closed) return;
        let changed = refresh || !this.snapshot || signature(next) !== signature(this.snapshot) || Boolean(this.error);
        if (next.scale) this.scaleWidth = this.size.width;
        for (const p of next.panes) {
          const previous = this.snapshot?.panes.find(old => old.pane === p.pane);
          if (refresh || !previous || previous.terminal !== p.terminal || previous.cols !== p.cols || previous.rows !== p.rows) {
            this.buffers.set(p.pane, new Buffer(p.screen));
            changed = true;
          } else if (this.buffers.get(p.pane).update(p.screen)) {
            changed = true;
          }
        }
        const present = new Set(next.panes.map(p => p.pane));
        for (const id of this.buffers.keys()) if (!present.has(id)) this.buffers.delete(id);
        if (!present.has(this.selected)) this.selected = next.panes.find(p => p.terminal === this.back)?.pane ?? next.panes[0]?.pane;
        // Never persist terminal buffers in diagnostics.
        this.snapshot = { ...next, scale: next.scale ?? this.snapshot?.scale, panes: next.panes.map(({ screen, ...p }) => p) };
        this.error = null;
        if (changed) { this.dump(cx); cx.notify(); }
      } catch (e) { if (!this.closed) { this.error = String(e.message ?? e); cx.notify(); } }
      finally { this.loading = false; }
    });
  }

  geometry() {
    return this.snapshot ? paneRects(layout(), this.size, this.snapshot.split_tree, settings().zoom ?? 1, this.snapshot.zoomed) : { panes: [] };
  }

  dump(cx) {
    if (!this.debug) return;
    const b = this.buffers.get(this.selected);
    const info = { created: this.created, size: this.size, geometry: this.geometry(), snapshot: this.snapshot,
      mode: this.mode, query: this.query, selected: this.selected, cursor: b?.cursor,
      selection: b?.spans(), labels: this.labels().map(({ continuation, ...m }) => m) };
    this.pendingDebug = info;
    if (this.writingDebug) return;
    this.writingDebug = true;
    cx.spawn(async () => {
      try {
        const file = appHome() + "/data/vim-copy-debug.json";
        while (this.pendingDebug) {
          const latest = this.pendingDebug;
          this.pendingDebug = null;
          await writeTextFile(file, JSON.stringify(latest, null, 2), await readTextFile(file));
        }
      } catch {} // A diagnostic failure must never break copying.
      finally { this.writingDebug = false; }
    });
  }

  labels() { return this.mode === "jump" && this.query.length >= 2 ? labelMatches(matches(this.buffers, this.query)) : []; }

  jump(m) {
    if (m.pane !== this.selected) this.buffers.get(this.selected)?.clear();
    this.selected = m.pane;
    this.buffers.get(m.pane)?.place(m.row, m.index);
    this.lastQuery = this.query || this.lastQuery;
    this.mode = "normal"; this.query = ""; this.labelInput = "";
  }

  repeat(reverse = false) {
    const found = matches(this.buffers, this.lastQuery);
    if (!found.length) return;
    const b = this.buffers.get(this.selected);
    const current = found.findIndex(m => m.pane === this.selected && m.row === b.cursor.row && m.index === b.cursor.index);
    const target = current < 0 ? reverse ? found.length - 1 : 0 : (current + (reverse ? found.length - 1 : 1)) % found.length;
    this.jump(found[target]);
  }

  leave(target = this.selected) {
    this.closed = true;
    const terminal = this.snapshot?.panes.find(p => p.pane === target)?.terminal ?? this.back;
    closeOverlay(props().overlay);
    if (terminal) run("pane.focus", { terminal });
  }

  close() { this.closed = true; this.buffers.clear(); }

  copy(cx) {
    if (this.copying) return;
    this.copying = true;
    const target = this.selected, previous = this.snapshot;
    cx.spawn(async cx => {
      try {
        const latest = await this.read();
        if (this.closed) return;
        if (signature(latest) !== signature(previous)) throw new Error("Pane layout changed; try copying again");
        const p = latest.panes.find(p => p.pane === target);
        const buffer = this.buffers.get(target);
        if (!p || !buffer) throw new Error("The selected terminal is no longer visible");
        buffer.update(p.screen);
        cx.write_to_clipboard(buffer.text());
        this.leave(target);
      } catch (error) {
        if (!this.closed) { this.error = "Copy failed: " + String(error.message ?? error); cx.notify(); }
      } finally { this.copying = false; }
    });
  }

  key(e, cx) {
    const chord = e.keystroke, key = e.key_char || e.key;
    if (e.modifiers?.platform && chord !== "cmd-c" && chord !== "cmd-shift-c") return;
    cx.stop_propagation();
    if (this.copying) {
      if (e.key === "escape" || chord === "cmd-shift-c") this.leave();
      return;
    }
    const b = this.buffers.get(this.selected);
    if (chord === "cmd-shift-c") { this.leave(); return; }
    if (e.key === "escape") {
      if (this.mode !== "normal") { this.mode = "normal"; this.query = ""; this.labelInput = ""; }
      else if (b?.anchor) b.clear();
      else this.leave();
    } else if (!b) { if (key === "q") this.leave(); }
    else if (this.mode !== "normal") {
      if (e.key === "enter") { const first = matches(this.buffers, this.query)[0]; if (first) this.jump(first); }
      else if (e.key === "backspace") {
        if (this.labelInput) this.labelInput = this.labelInput.slice(0, -1);
        else this.query = [...this.query].slice(0, -1).join("");
      } else if (!e.modifiers?.control && !e.modifiers?.alt && [...key].length === 1) {
        const labels = this.labels(), prefix = this.labelInput + key;
        const target = labels.find(m => m.label === prefix);
        if (target) this.jump(target);
        else if (labels.some(m => m.label.startsWith(prefix))) this.labelInput = prefix;
        else { this.labelInput = ""; this.query += key; }
      }
    } else if (key === "q") this.leave();
    else if (key === "s" || key === "/" || key === "?") { this.mode = key === "s" ? "jump" : "search"; this.query = ""; this.labelInput = ""; }
    else if (key === "v" || key === "V" || e.key === "space") b.select(key === "V");
    else if (key === "y" || e.key === "enter" || chord === "cmd-c") {
      this.copy(cx);
    } else if (key === "r") this.load(cx, true);
    else if (e.key === "tab") {
      const panes = this.snapshot.panes, at = panes.findIndex(p => p.pane === this.selected);
      b.clear(); this.selected = panes[(at + (e.modifiers?.shift ? panes.length - 1 : 1)) % panes.length].pane;
    } else if (key === "n" || key === "N") this.repeat(key === "N");
    else if (/^[1-9]$/.test(key) || key === "0" && this.count) this.count = (this.count + key).slice(0, 3);
    else {
      const count = Number(this.count) || 1; this.count = "";
      if (chord === "ctrl-d" || chord === "ctrl-u") b.vertical((chord === "ctrl-u" ? -1 : 1) * Math.max(1, Math.floor(b.rows.length / 2)));
      else if (e.key === "pagedown" || chord === "ctrl-f") b.vertical(b.rows.length - 1);
      else if (e.key === "pageup" || chord === "ctrl-b") b.vertical(1 - b.rows.length);
      else if (key === "{" || key === "}") {
        const direction = key === "{" ? -1 : 1; let row = b.cursor.row + direction;
        while (row > 0 && row < b.rows.length - 1 && b.rows[row].length) row += direction;
        b.place(row, 0);
      } else b.move(key, count);
    }
    this.dump(cx); cx.notify();
  }

  render() {
    const t = theme(), s = settings(), fs = (s.font_size ?? 14) * (s.zoom ?? 1);
    // Herdr 0.1.14's bundled JetBrains Mono: hhea ascent 1020, descent -300,
    // units/em 1000; the renderer multiplies by 1.15 and rounds to device pixels.
    const scale = this.snapshot?.scale ?? 2;
    const cell = { width: fs * this.widthRatio, height: Math.ceil(fs * 1.32 * 1.15 * scale) / scale };
    const found = this.query ? matches(this.buffers, this.query) : [];
    const labels = this.labels().filter(m => m.label.startsWith(this.labelInput));
    const root = div().id("vim-copy-root").size_full().relative().track_focus(this.handle).key_context("VimCopy")
      .on_size_change((size, cx) => { this.size = size; this.handle.focus(); this.dump(cx); cx.notify(); })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
      .on_key_down((e, cx) => this.key(e, cx));
    root.child(div().id("vim-copy-measure").absolute().left(0).top(0).opacity(0).font_family(s.font_family).font_medium().text_size(fs)
      .child("MMMMMMMMMM").on_size_change((size, cx) => {
        const ratio = size.width / 10 / fs;
        if (ratio > 0 && Math.abs(ratio - this.widthRatio) > 0.0001) { this.widthRatio = ratio; cx.notify(); }
      }));
    for (const p of this.geometry().panes) {
      const b = this.buffers.get(p.pane), meta = this.snapshot.panes.find(m => m.pane === p.pane);
      const box = gridRect(p.rect, meta?.cols ?? 0, meta?.rows ?? 0, cell, s.terminal_padding ?? [8, 8], s.zoom ?? 1, scale);
      const active = this.selected === p.pane;
      const body = div().absolute().left(p.rect.x).top(p.rect.y).w(p.rect.width).h(p.rect.height).overflow_hidden();
      if (this.outlines) body.border(1).border_color(t.accent).bg(t.accent + "08");
      else if (b) {
        // A 10% tint leaves the original terminal visible through the layer.
        body.bg(t.background.slice(0, 7) + "1a");
        const grid = div().absolute().left(box.x - p.rect.x).top(box.y - p.rect.y).w(box.width).h(box.height)
          .font_family(s.font_family).font_medium().text_size(fs).text_color(t.foreground).line_height(cell.height + "px");
        const rect = (col, row, width, color) => div().absolute().left(col * cell.width).top(row * cell.height).w(width * cell.width).h(cell.height).bg(color);
        for (const m of found.filter(m => m.pane === p.pane)) grid.child(rect(m.col, m.row, m.width, t.accent + "40"));
        for (const span of b.spans()) grid.child(rect(span.col, span.row, span.width, t.selection.slice(0, 7) + "80"));
        if (active) grid.child(rect(b.column(), b.cursor.row, b.glyph()?.width ?? 1, t.accent + "66"));
        for (const m of labels.filter(m => m.pane === p.pane)) {
          const col = Math.min(meta.cols - m.label.length, m.col + m.width);
          grid.child(div().absolute().left(Math.max(0, col) * cell.width).top(m.row * cell.height).w(m.label.length * cell.width).h(cell.height)
            .line_height(cell.height + "px").bg(t.accent).text_color(t.accent_foreground).font_semibold().child(m.label));
        }
        body.child(grid);
      }
      root.child(body);
      if (active || this.outlines) {
        const state = this.outlines ? `${p.terminal} · ${Math.round(p.rect.x)},${Math.round(p.rect.y)} ${Math.round(p.rect.width)}×${Math.round(p.rect.height)}` :
          this.mode !== "normal" ? `${this.mode.toUpperCase()} ${this.query}${this.labelInput ? " → " + this.labelInput : ""} · ${found.length} matches` :
          `${b?.anchor ? b.linewise ? "V-LINE" : "VISUAL" : "COPY"} · s jump · / search · v select · y copy · Esc exit`;
        root.child(div().absolute().left(Math.max(p.frame.x + 6, p.frame.x + p.frame.width - 390)).top(p.frame.y + 4)
          .h(22).px(7).rounded(4).bg(t.background).text_color(t.accent).text_size(11).line_height("22px").child(state));
      }
    }
    if (this.error || !this.snapshot) root.child(div().absolute().left(300).top(80).p(12).bg(t.background).text_color(this.error ? t.blocked : t.muted)
      .child((this.error ?? "Reading terminal screens…") + " · Esc closes"));
    return root;
  }
}
