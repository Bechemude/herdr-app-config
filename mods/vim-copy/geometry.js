// Logical-pixel counterpart of Herdr's flex layout and pane frame rules.
// Read-only: layout() supplies clicked sizes; core supplies each tab's split tree.
const children = n => (n.children ?? []).filter(c => !c.hidden);
const weight = n => n.size?.px != null ? 0 : n.size?.weight ?? 1;
const width = line => line ? line.width ?? 1 : 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function shares(nodes, available, zoom = 1) {
  const sizes = nodes.map(() => 0);
  let pending = [], left = available;
  nodes.forEach((n, i) => {
    if (n.size?.px != null) {
      sizes[i] = clamp(n.size.px * zoom, (n.min ?? 0) * zoom, (n.max ?? Infinity) * zoom);
      left -= sizes[i];
    } else pending.push(i);
  });
  const totalWeight = pending.reduce((sum, i) => sum + weight(nodes[i]), 0) || 1;
  const initialFree = Math.max(0, left);
  while (pending.length) {
    const total = pending.reduce((sum, i) => sum + weight(nodes[i]), 0) || 1;
    const free = Math.min(Math.max(0, left), initialFree * total / totalWeight);
    const violations = pending.map(i => {
      const n = nodes[i], share = free * weight(n) / total;
      sizes[i] = clamp(share, (n.min ?? 0) * zoom, (n.max ?? Infinity) * zoom);
      return [i, sizes[i] - share];
    });
    const violation = violations.reduce((sum, [, v]) => sum + v, 0);
    if (Math.abs(violation) < 0.000001) break;
    const frozen = violations.filter(([, v]) => violation > 0 ? v > 0 : v < 0).map(([i]) => i);
    if (!frozen.length) break;
    for (const i of frozen) left -= sizes[i];
    pending = pending.filter(i => !frozen.includes(i));
  }
  return sizes;
}

export function inset(r, x, y = x, right = x, bottom = y) {
  return { x: r.x + x, y: r.y + y,
    width: Math.max(0, r.width - x - right), height: Math.max(0, r.height - y - bottom) };
}

export function paneRects(chrome, viewport, tabRoot, zoom = 1, zoomed = null) {
  const panes = [], blocks = {};
  const find = (n, id) => n.id === id ? n : (n.children ?? []).map(c => find(c, id)).find(Boolean);
  const paneCount = n => (n.content?.terminal || n.content?.mod ? 1 : 0) +
    (n.children ?? []).reduce((sum, c) => sum + paneCount(c), 0);
  function walk(n, rect, frame = null, isTab = false) {
    if (!n || n.hidden || rect.width <= 0 || rect.height <= 0) return;
    let r = inset(rect, width(n.border) * zoom);
    const [py, px] = Array.isArray(n.padding) ? n.padding : [n.padding ?? 0, n.padding ?? 0];
    r = inset(r, px * zoom, py * zoom);
    blocks[n.id] = r;
    if (n.type === "block") {
      const content = n.content ?? {};
      if (content.tab || content.context) {
        const f = content.pane;
        const actualFrame = f && (f.lone || paneCount(tabRoot) > 1) ? f : null;
        const root = zoomed ? find(tabRoot, zoomed) : tabRoot;
        if (root) walk(root, r, actualFrame, true);
      } else if (content.terminal) {
        const outer = r;
        if (isTab && frame) {
          r = inset(r, width(frame.border) * zoom);
          const h = frame.header;
          if (h && h.reveal !== "hover") {
            const height = (h.height ?? 30) * zoom;
            r = h.position === "bottom" ? inset(r, 0, 0, 0, height) : inset(r, 0, height, 0, 0);
          }
        }
        panes.push({ pane: n.id, terminal: content.terminal, frame: outer, rect: r });
      }
      return;
    }
    const shown = children(n);
    if (n.type === "stack") {
      const h = n.header;
      if (h) {
        const height = (h.height ?? 30) * zoom;
        r = h.position === "bottom" ? inset(r, 0, 0, 0, height) : inset(r, 0, height, 0, 0);
      }
      const active = shown.find(c => c.id === n.active) ?? shown[0];
      if (active) walk(active, r, frame, isTab);
      return;
    }
    const row = n.type === "row";
    const separator = ((n.gap ?? frame?.gap ?? 0) + width(n.divider)) * zoom;
    const available = (row ? r.width : r.height) - separator * Math.max(0, shown.length - 1);
    const sizes = shares(shown, available, zoom);
    let cursor = row ? r.x : r.y;
    shown.forEach((child, i) => {
      const box = row ? { x: cursor, y: r.y, width: sizes[i], height: r.height } :
        { x: r.x, y: cursor, width: r.width, height: sizes[i] };
      walk(child, box, frame, isTab);
      cursor += sizes[i] + separator;
    });
  }
  walk(chrome, { x: 0, y: 0, ...viewport });
  return { panes, blocks };
}

export function gridRect(rect, cols, rows, cell, padding = [8, 8], zoom = 1, scale = 1) {
  const [px, py] = padding.map(v => v * zoom);
  const spare = Math.max(0, rect.height - 2 * py - rows * cell.height);
  const snap = n => Math.round(n * scale) / scale;
  return { x: snap(rect.x + px), y: snap(rect.y + py + Math.floor(spare / 2)),
    width: cols * cell.width, height: rows * cell.height };
}
