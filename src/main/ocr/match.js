// Turns OCR lines into an augment offer: finds lines that read like augment
// names (fuzzy, OCR is never perfect) and keeps them only when two or more sit
// side by side, the way the offer cards do.

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Edit distance that also counts a swap of two neighbouring letters as one
// edit (optimal string alignment), a common OCR slip.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const similarity = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length, 1);

function buildIndex(augments) {
  // Several augments can share a display name; any of them identifies the card.
  return Object.values(augments)
    .filter((a) => a.name && norm(a.name).length >= 3)
    .map((a) => ({ id: a.id, key: norm(a.name) }));
}

function lineBox(line) {
  const xs = line.words.map((w) => w.x);
  const ys = line.words.map((w) => w.y);
  const x2 = Math.max(...line.words.map((w) => w.x + w.w));
  const y2 = Math.max(...line.words.map((w) => w.y + w.h));
  return { x: Math.min(...xs), y: Math.min(...ys), w: x2 - Math.min(...xs), h: y2 - Math.min(...ys) };
}

function bestMatch(text, index) {
  const t = norm(text);
  if (t.length < 3) return null;
  let best = null;
  for (const a of index) {
    if (Math.abs(a.key.length - t.length) > Math.max(3, a.key.length * 0.35)) continue;
    const s = similarity(t, a.key);
    if (!best || s > best.s) best = { id: a.id, s };
  }
  const need = t.length <= 6 ? 0.86 : 0.78;
  return best && best.s >= need ? best : null;
}

// lines: OCR output; index: buildIndex(); height: image height (pixels of the
// captured region); min: names needed (1 while an offer is already on screen,
// so a single rerolled card is picked up). Returns
// [{ id, x, y, w, h, score }] left to right, or [].
function findOffer(lines, index, height, min = 2) {
  const usable = (lines || []).filter((l) => l.words && l.words.length);
  const hits = [];
  usable.forEach((line, i) => {
    const box = lineBox(line);
    const m = bestMatch(line.text, index);
    if (m) hits.push({ ...m, ...box });
    // Long names wrap onto two lines on the card.
    const next = usable[i + 1];
    if (next) {
      const nb = lineBox(next);
      if (Math.abs(nb.x + nb.w / 2 - (box.x + box.w / 2)) < box.w && nb.y - (box.y + box.h) < box.h * 1.5) {
        const m2 = bestMatch(`${line.text} ${next.text}`, index);
        if (m2 && (!m || m2.s > m.s)) hits.push({ ...m2, x: Math.min(box.x, nb.x), y: box.y, w: Math.max(box.w, nb.w), h: nb.y + nb.h - box.y });
      }
    }
  });
  // One hit per card column, strongest wins.
  hits.sort((a, b) => b.s - a.s);
  const cards = [];
  for (const h of hits) {
    const cx = h.x + h.w / 2;
    if (cards.some((c) => Math.abs(c.x + c.w / 2 - cx) < Math.max(c.w, h.w) * 0.6 || c.id === h.id)) continue;
    cards.push(h);
  }
  if (cards.length < min) return [];
  // Offer cards share a row.
  const rowY = cards.map((c) => c.y).sort((a, b) => a - b)[Math.floor(cards.length / 2)];
  const row = cards.filter((c) => Math.abs(c.y - rowY) < height * 0.08);
  if (row.length < min) return [];
  return row.sort((a, b) => a.x - b.x).slice(0, 4).map(({ id, x, y, w, h, s }) => ({ id, x, y, w, h, score: s }));
}

module.exports = { findOffer, buildIndex, bestMatch, similarity, norm };
