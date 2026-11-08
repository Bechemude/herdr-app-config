// Pane dock: minimized panes of the shown tab, as chips in a floating tray.
//
// Minimize = `terminal.park` (the pane goes away, the terminal keeps running).
// Restore  = `terminal.keep {place: "right"}` (a pane again, beside the focused one).
//
// Which terminals were minimized, and from which tab, lives in shared("pane-dock"):
//   { [terminal address]: { tab, space, at, parked?, restoring? } }
// park and keep finish in the background: the pane stays on screen until herdr-core
// replies. So a fresh record whose terminal is still in a pane is "pending", not done,
// and a second park/keep on it would fail ("already has a pane change in progress").
// The pane header (my-pane) writes the same record when its minimize button is clicked.
//
// Keys (bound in keys.json): "pane-dock.minimize" minimizes the focused pane;
// "pane-dock.focus" moves the keyboard to the dock: h/l (or arrows) pick a chip,
// Enter restores it, Escape goes back to the pane you came from.
// Only terminal panes can be minimized, and never the last pane of a tab.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  panes, terminals, spaces, focused, shared, setShared, run, theme, notify,
  placement, nextCommand,
} from "herdr";

const KEY = "pane-dock";
// How long a park or keep may take before we treat it as failed.
const PENDING_MS = 15000;

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
  const r = minimized()[p.terminal];
  if (r && !r.parked && Date.now() - r.at < PENDING_MS) return; // already being minimized
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
    this.handle = cx.focus_handle();
    this.active = false; // keyboard mode: a chip is selected
    this.held = false;   // the handle got the keyboard at least once in this mode
    this.at = 0;         // selected chip
    this.back = null;    // pane to return to on Escape
    this.chips = [];     // terminals shown on the last render
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "minimize") {
          const f = focused();
          if (f?.pane) minimizePane(f.pane);
        } else if (c === "focus") {
          this.enter();
        }
        cx.notify();
      }
    });
  }

  enter() {
    if (this.chips.length === 0) {
      notify({ title: "No minimized panes", body: "Nothing in the dock for this tab.", level: "info", timeout: 2000 });
      return;
    }
    if (!this.active) this.back = focused()?.pane ?? null;
    this.active = true;
    this.held = false;
    this.at = Math.min(this.at, this.chips.length - 1);
    this.handle.focus();
  }

  leave() {
    this.active = false;
    this.held = false;
  }

  key(e, cx) {
    if (!this.active) return;
    const n = this.chips.length;
    const k = e.keystroke;
    if (k === "h" || k === "k" || k === "left" || k === "up") this.at = (this.at + n - 1) % n;
    else if (k === "l" || k === "j" || k === "right" || k === "down") this.at = (this.at + 1) % n;
    else if (k === "enter" || k === "space") {
      const term = this.chips[this.at];
      this.leave();
      if (term) this.restore(term.address, cx);
    } else if (k === "escape") {
      this.leave();
      const tab = focused()?.tab;
      const back = panes().find((p) => p.pane === this.back) ?? panes().find((p) => p.tab === tab);
      if (back) run("pane.focus", { pane: back.pane });
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  // After a keyboard restore, focus the pane once it's back.
  focusWhenBack(address, cx, tries = 30) {
    cx.timer.after(100, (cx) => {
      if (panes().some((p) => p.terminal === address)) run("pane.focus", { terminal: address });
      else if (tries > 1) this.focusWhenBack(address, cx, tries - 1);
    });
  }

  // Keep the record until the pane is really back (prune drops it then), so a failed
  // keep brings the chip back instead of losing the terminal.
  restore(address, cx) {
    const m = minimized();
    const r = m[address];
    if (!r || (r.restoring && Date.now() - r.restoring < PENDING_MS)) return;
    setShared(KEY, { ...m, [address]: { ...r, restoring: Date.now() } });
    // From the keyboard, keep it beside the pane you came from, then focus it.
    if (cx && this.back && panes().some((p) => p.pane === this.back)) run("pane.focus", { pane: this.back });
    run("terminal.keep", { terminal: address, place: "right" });
    if (cx) this.focusWhenBack(address, cx);
  }

  // Bring records up to date with what Herdr shows:
  // - terminal ended: drop it;
  // - out of its pane: the park is done (parked);
  // - in a pane after being parked: restored (here or elsewhere): drop it;
  // - in a pane, never parked: the park is still pending; after PENDING_MS it failed: drop it.
  // Skip while terminals() is still empty (app starting), so nothing is lost.
  prune(m, live) {
    if (live.size === 0) return m;
    const inPane = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const now = Date.now();
    let changed = false;
    const keep = {};
    for (const [a, r] of Object.entries(m)) {
      if (!live.has(a)) { changed = true; continue; }
      if (inPane.has(a)) {
        if (r.parked || now - r.at >= PENDING_MS) { changed = true; continue; }
        keep[a] = r;
      } else if (!r.parked) {
        keep[a] = { ...r, parked: true };
        changed = true;
      } else {
        keep[a] = r;
      }
    }
    if (changed) setShared(KEY, keep);
    return keep;
  }

  chip(t, term, vertical, selected) {
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
      .bg(selected ? t.selected : t.raised)
      .border(selected ? 2 : 1)
      .border_color(selected ? t.accent : st === "blocked" ? t.blocked : t.border)
      .text_size(12)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.restore(term.address); })
      .shadow_md()
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
      .filter(([a, r]) => r.tab === tab && r.parked && byAddress.has(a)
        && !(r.restoring && Date.now() - r.restoring < PENDING_MS))
      .sort((a, b) => a[1].at - b[1].at)
      .map(([a]) => byAddress.get(a));
    this.chips = here;
    // Leave keyboard mode when the keyboard went elsewhere (a click on a pane).
    if (this.active) {
      if (this.handle.is_focused()) this.held = true;
      else if (this.held) this.leave();
    }
    if (here.length === 0) {
      this.leave();
      return div().track_focus(this.handle);
    }
    this.at = Math.min(this.at, here.length - 1);

    const vertical = Boolean(placement()?.vertical);
    const row = vertical ? v_flex() : h_flex();
    return row
      .id("pane-dock")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .p(4)
      .gap(4)
      .children(here.map((term, i) => this.chip(t, term, vertical, this.active && i === this.at)));
  }
}
