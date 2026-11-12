const compare = (a, b) => a.row - b.row || a.index - b.index;
const copy = p => ({ row: p.row, index: p.index });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const kind = (s, big) => /\s/u.test(s) ? 0 : big || /[\p{L}\p{N}_]/u.test(s) ? 1 : 2;

export class Buffer {
  constructor(rows) {
    this.rows = rows.length ? rows : [[]];
    this.cursor = { row: 0, index: 0 };
    this.anchor = null;
    this.linewise = false;
    this.goal = 0;
  }
  glyph(p = this.cursor) { return this.rows[p.row]?.[p.index]; }
  update(rows) {
    if (JSON.stringify(this.rows) === JSON.stringify(rows)) return false;
    const cursor = { row: this.cursor.row, col: this.column() };
    const anchor = this.anchor ? { row: this.anchor.row, col: this.column(this.anchor) } : null;
    this.rows = rows.length ? rows : [[]];
    this.cursor = this.atColumn(cursor.row, cursor.col);
    this.anchor = anchor ? this.atColumn(anchor.row, anchor.col) : null;
    return true;
  }
  column(p = this.cursor) { return this.glyph(p)?.col ?? 0; }
  place(row, index, vertical = false) {
    row = clamp(row, 0, this.rows.length - 1);
    this.cursor = { row, index: clamp(index, 0, Math.max(0, this.rows[row].length - 1)) };
    if (!vertical) this.goal = this.column();
  }
  atColumn(row, column) {
    row = clamp(row, 0, this.rows.length - 1);
    let index = this.rows[row].findIndex(g => g.col + g.width > column);
    if (index < 0) index = this.rows[row].length - 1;
    return { row, index: Math.max(0, index) };
  }
  vertical(delta) {
    const p = this.atColumn(this.cursor.row + delta, this.goal);
    this.place(p.row, p.index, true);
  }
  move(key, count = 1) {
    const { row, index } = this.cursor;
    if (key === "h" || key === "left") this.place(row, index - count);
    else if (key === "l" || key === "right") this.place(row, index + count);
    else if (key === "j" || key === "down") this.vertical(count);
    else if (key === "k" || key === "up") this.vertical(-count);
    else if (key === "0" || key === "home") this.place(row, 0);
    else if (key === "$" || key === "end") this.place(row, this.rows[row].length - 1);
    else if (key === "^") this.place(row, Math.max(0, this.rows[row].findIndex(g => /\S/u.test(g.text))));
    else if (key === "g") this.place(0, 0);
    else if (key === "G") {
      let last = this.rows.length - 1;
      while (last > 0 && !this.rows[last].length) last--;
      this.place(last, 0);
    } else if ("wbeWBE".includes(key) && key.length === 1) {
      for (let i = 0; i < count; i++) this.word(key);
    } else return false;
    return true;
  }
  word(key) {
    const flat = this.rows.flatMap((row, r) => [...row.map((g, index) => ({ text: g.text, row: r, index })), { text: "\n", row: r, index: row.length }]);
    let at = flat.findIndex(g => g.row === this.cursor.row && g.index === this.cursor.index);
    if (at < 0) return;
    const type = i => kind(flat[i]?.text ?? " ", key === key.toUpperCase());
    if (key.toLowerCase() === "w") {
      const previous = type(at);
      while (at < flat.length - 1 && type(at) === previous) at++;
      while (at < flat.length - 1 && !type(at)) at++;
    } else if (key.toLowerCase() === "b") {
      at = Math.max(0, at - 1);
      while (at > 0 && !type(at)) at--;
      const previous = type(at);
      while (at > 0 && type(at - 1) === previous) at--;
    } else {
      at = Math.min(flat.length - 1, at + 1);
      while (at < flat.length - 1 && !type(at)) at++;
      const previous = type(at);
      while (at < flat.length - 1 && type(at + 1) === previous) at++;
    }
    this.place(flat[at].row, flat[at].index);
  }
  select(linewise = false) {
    if (this.anchor && this.linewise === linewise) this.anchor = null;
    else { this.anchor = copy(this.cursor); this.linewise = linewise; }
  }
  clear() { this.anchor = null; }
  range() {
    const anchor = this.anchor ?? this.cursor;
    return compare(anchor, this.cursor) <= 0 ? [anchor, this.cursor] : [this.cursor, anchor];
  }
  spans() {
    if (!this.anchor) return [];
    const [a, b] = this.range(), result = [];
    for (let row = a.row; row <= b.row; row++) {
      const glyphs = this.rows[row];
      const from = this.linewise || row !== a.row ? 0 : a.index;
      const to = this.linewise || row !== b.row ? glyphs.length - 1 : b.index;
      const first = glyphs[from], last = glyphs[to];
      result.push({ row, col: first?.col ?? 0, width: last ? last.col + last.width - (first?.col ?? 0) : 1 });
    }
    return result;
  }
  text() {
    if (!this.anchor) return this.rows[this.cursor.row].map(g => g.text).join("").trimEnd();
    const [a, b] = this.range(), lines = [];
    for (let row = a.row; row <= b.row; row++) {
      const from = this.linewise || row !== a.row ? 0 : a.index;
      const to = this.linewise || row !== b.row ? this.rows[row].length : b.index + 1;
      lines.push(this.rows[row].slice(from, to).map(g => g.text).join(""));
    }
    return lines.join("\n") + (this.linewise ? "\n" : "");
  }
}

export function matches(buffers, query) {
  if (!query) return [];
  const sensitive = query !== query.toLowerCase();
  const needle = sensitive ? query : query.toLowerCase();
  const result = [];
  for (const [pane, buffer] of buffers) {
    buffer.rows.forEach((glyphs, row) => {
      const original = glyphs.map(g => g.text).join("");
      const text = sensitive ? original : original.toLowerCase();
      let start = 0, at;
      while ((at = text.indexOf(needle, start)) >= 0) {
        let offset = 0, index = 0;
        while (index < glyphs.length && offset + glyphs[index].text.length <= at) offset += glyphs[index++].text.length;
        let end = index, endOffset = offset;
        while (end < glyphs.length && endOffset < at + needle.length) endOffset += glyphs[end++].text.length;
        const first = glyphs[index], last = glyphs[end - 1];
        if (first && last) result.push({ pane, row, index, col: first.col, width: last.col + last.width - first.col,
          continuation: original.slice(at + query.length, at + query.length + 1).toLowerCase() });
        start = at + Math.max(1, needle.length);
      }
    });
  }
  return result;
}

export function labelMatches(found) {
  const blocked = new Set(found.map(m => m.continuation));
  const alphabet = [..."asdfghjklqwertyuiopzxcvbnm"].filter(c => !blocked.has(c));
  if (alphabet.length < 2) return [];
  let length = 1;
  while (Math.pow(alphabet.length, length) < found.length) length++;
  return found.map((m, index) => {
    let label = "", value = index;
    for (let i = 0; i < length; i++) { label = alphabet[value % alphabet.length] + label; value = Math.floor(value / alphabet.length); }
    return { ...m, label };
  });
}
