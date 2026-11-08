// Pane dock: minimized panes of the shown tab, as chips in a floating tray.
//
// Minimize = `terminal.park` (the pane goes away, the terminal keeps running).
// Restore  = `terminal.keep {place: "right"}` (a pane again, beside the focused one).
//
// Which terminals were minimized, and from which tab, lives in shared("pane-dock"):
//   { [terminal address]: { tab, space, at } }
// The pane header (my-pane) writes the same record when its minimize button is clicked.
//
// Keys: "pane-dock.minimize" minimizes the focused pane (bound in keys.json).
// Only terminal panes can be minimized, and never the last pane of a tab.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  panes, terminals, spaces, focused, shared, setShared, run, theme, notify,
  placement, nextCommand,
} from "herdr";

const KEY = "pane-dock";

function minimized() {
  const m = shared(KEY);
  return m && typeof m === "object" ? m : {};
}

function tabOf(id) {
  for (const s of spaces()) for (const t of s.tabs) if (t.id === id) return { space: s, tab: t };
  return null;
}

export function minimizePane(paneId) {
  const p = panes().find((x) => x.pane === paneId);
  if (!p) return;
  if (!p.terminal) {
    notify({ title: "Can't minimize this pane", body: "Only terminal panes can be minimized.", level: "warning", timeout: 3000 });
    return;
  }
  const where = tabOf(p.tab);
  if (!where || where.tab.panes < 2) {
    notify({ title: "Can't minimize the last pane", body: "A tab needs at least one pane on screen.", level: "warning", timeout: 3000 });
    return;
  }
  setShared(KEY, { ...minimized(), [p.terminal]: { tab: p.tab, space: where.space.id, at: Date.now() } });
  run("terminal.park", { terminal: p.terminal });
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function label(term) {
  const prog = term.program;
  if (prog?.shell && prog.name) {
    const dir = String(term.cwd ?? "").replace(/\/+$/, "").split("/").pop();
    return dir ? `${prog.name} · ${dir}` : prog.name;
  }
  if (prog?.agent && prog.name) return prog.name;
  return term.name || term.title || prog?.name || term.address;
}

export default class PaneDock extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "minimize") {
          const f = focused();
          if (f?.pane) minimizePane(f.pane);
        }
        cx.notify();
      }
    });
  }

  restore(address) {
    const { [address]: _gone, ...rest } = minimized();
    setShared(KEY, rest);
    run("terminal.keep", { terminal: address, place: "right" });
  }

  // Drop records whose terminal is back in a pane or has ended.
  // Skip while terminals() is still empty (app starting), so nothing is lost.
  prune(m, live) {
    if (live.size === 0) return m;
    const inPane = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const keep = Object.fromEntries(Object.entries(m).filter(([a]) => live.has(a) && !inPane.has(a)));
    if (Object.keys(keep).length !== Object.keys(m).length) setShared(KEY, keep);
    return keep;
  }

  chip(t, term, vertical) {
    const st = term.report?.status ?? term.status;
    const name = label(term);
    const pic = icon(term.program, 14, t.dim);
    return h_flex()
      .id(`dock-${term.address}`)
      .h(26)
      .px(10)
      .gap(6)
      .items_center()
      .flex_none()
      .when(!vertical, (el) => el.max_w(200))
      .rounded(13)
      .bg(t.raised)
      .border(1)
      .border_color(st === "blocked" ? t.blocked : t.border)
      .text_size(12)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.restore(term.address); })
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().truncate().child(name))
      .when(st === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.blocked)))
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)));
  }

  render(cx) {
    const t = theme();
    const all = terminals();
    const byAddress = new Map(all.filter((x) => x.state !== "exited").map((x) => [x.address, x]));
    const m = this.prune(minimized(), new Set(byAddress.keys()));
    const tab = focused()?.tab;
    const here = Object.entries(m)
      .filter(([a, r]) => r.tab === tab && byAddress.has(a))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([a]) => byAddress.get(a));
    if (here.length === 0) return div();

    const vertical = Boolean(placement()?.vertical);
    const row = vertical ? v_flex() : h_flex();
    return row
      .id("pane-dock")
      .p(4)
      .gap(4)
      .children(here.map((term) => this.chip(t, term, vertical)));
  }
}
