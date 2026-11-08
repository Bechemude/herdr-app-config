// A markdown file, rendered, as a pane beside the terminals. Props: { file (absolute), on (machine or null) }.
// Follows the file as it changes; links to other markdown files open here, web links in the browser.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { props, exec, readTextFile, watchFolder, theme } from "herdr";

const dir = (path) => path.replace(/\/[^/]*$/, "");
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return "/" + out.join("/");
}

export default class MarkdownView extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.file = p.file;
    this.on = p.on ?? null;
    this.text = null;
    this.error = null;
    this.load(cx);
    // Remote files can't be watched: look again now and then.
    cx.timer.every(this.on ? 5000 : 30000, (cx) => this.load(cx));
    if (!this.on && this.file) this.watch(cx);
  }

  watch(cx) {
    const folder = dir(this.file), file = this.file;
    cx.spawn(async (cx) => {
      try { while (this.file === file) { await watchFolder(folder); this.load(cx); } } catch {}
    });
  }

  load(cx) {
    const file = this.file;
    if (!file) { this.error = "No file"; cx.notify(); return; }
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on: this.on });
        if (file !== this.file) return;
        if (text === null) this.error = "This file is no longer available";
        else if (text !== this.text) { this.text = text; this.error = null; }
        else return;
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  link(url, cx) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("file:")) { exec("open", [url]); return; }
    const target = decodeURIComponent(url.replace(/^file:\/\//, "").split("#")[0]);
    if (!target) return;
    const next = normalize(target.startsWith("/") ? target : `${dir(this.file)}/${target}`);
    const changesFolder = dir(next) !== dir(this.file);
    this.file = next;
    this.text = null;
    this.load(cx);
    if (changesFolder && !this.on) this.watch(cx);
    cx.notify();
  }

  render() {
    const t = theme();
    const name = this.file?.split("/").pop() ?? "";
    return v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(30).flex_none().px(14).items_center().gap(8).border_b(1).border_color(t.border).text_size(12)
        .child(div().font_semibold().flex_none().child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.file ? dir(this.file) : "")))
      .child(this.text != null
        ? TextView.markdown(`md-view-${this.file}`, this.text).scrollable(true).selectable(true)
            .flex_1().min_h(0).w_full().px(24).py(16).text_size(14)
            .on_link_click((url, cx) => this.link(url, cx))
        : div().p(16).text_size(13).text_color(t.dim).child(this.error ?? "Loading…"));
  }
}
