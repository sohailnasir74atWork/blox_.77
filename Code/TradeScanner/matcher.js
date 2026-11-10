/**
 * Trade Scanner pixel matcher (2026-11-01).
 *
 * Finds the fruit slots of the in-game "TREASURE TRADE" window in a screenshot
 * and ranks each slot's picture against the bundled fruit signatures
 * (fruitSignatures.json, built by scripts/trade-scanner/build_signatures.py).
 *
 * Each trade slot is a green name bar, the fruit picture on a light panel, and
 * a pink (#ff00ff) price bar. We anchor on the pink bars (nothing overlays
 * them), walk up to the green bar, and treat what lies between as the picture.
 *
 * Plain ES5 on purpose: scripts/trade-scanner/build-html.js inlines this file
 * into the WebView page (Code/TradeScanner/scannerHtml.js), and jest requires
 * it directly. Everything runs on the phone; no image leaves it.
 */
/* global atob, Buffer */
(function (root) {
  var N = 20;            // signature edge, must match build_signatures.py
  var BG = [228, 228, 228];
  var SLOT_RATIO = 1.31;  // slot width / (name bar top to price bar top), median of 696 YouTube slots

  function isGreen(r, g, b) { return g > 140 && g - Math.max(r, b) > 70; }
  function isPink(r, g, b) { return r > 170 && b > 170 && Math.min(r, b) - g > 90; }
  // The "+" is drawn dimmed on inventory slots, so allow dark yellow.
  function isYellow(r, g, b) { return r > 140 && g > 130 && r - b > 80 && b < 0.55 * Math.min(r, g); }
  // Slot panel: light grey with a white shine stripe. Never part of a fruit.
  function isPanel(r, g, b) { return Math.min(r, g, b) > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 35; }

  // Camera photos of a monitor: colours drift, darken and lose saturation, so
  // the bars are found by hue instead of exact values (after normalizeColors).
  function hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return [0, 0, mx];
    var hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((hh * 60) + 360) % 360, d / mx, mx];
  }
  function isGreenLoose(r, g, b) { var c = hsv(r, g, b); return c[0] > 95 && c[0] < 155 && c[1] > 0.45 && c[2] > 110; }
  function isPinkLoose(r, g, b) { var c = hsv(r, g, b); return c[0] > 278 && c[0] < 332 && c[1] > 0.5 && c[2] > 110; }
  // Last try for a camera photo of a monitor (report e595f3c3): the price
  // bars wash out to lilac (hue ~275, saturation ~0.35) and the name bars of
  // a dimmer screen half go dark green (value ~80). Only used when the other
  // passes find nothing; the bar shape tests in findSlots still apply.
  function isGreenWide(r, g, b) { var c = hsv(r, g, b); return c[0] > 95 && c[0] < 160 && c[1] > 0.45 && c[2] > 60; }
  function isPinkWide(r, g, b) { var c = hsv(r, g, b); return c[0] > 262 && c[0] < 335 && c[1] > 0.25 && c[2] > 100; }

  // Per-channel levels stretch (1st..99th percentile -> 0..255). Undoes most of
  // a photo's colour cast and contrast loss; a clean screenshot barely changes.
  function normalizeColors(px, w, h) {
    var hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], n = 0;
    for (var p = 0; p < w * h * 4; p += 16) { hist[0][px[p]]++; hist[1][px[p + 1]]++; hist[2][px[p + 2]]++; n++; }
    var lut = [0, 1, 2].map(function (c) {
      var acc = 0, lo = 0, hi = 255;
      for (var v = 0; v < 256; v++) { acc += hist[c][v]; if (acc <= n * 0.01) lo = v; if (acc < n * 0.99) hi = v + 1; }
      if (hi - lo < 32) { lo = 0; hi = 255; }
      var t = new Uint8Array(256);
      for (var k = 0; k < 256; k++) t[k] = Math.max(0, Math.min(255, Math.round(((k - lo) * 255) / (hi - lo))));
      return t;
    });
    var out = new Uint8Array(w * h * 4);
    for (var q = 0; q < w * h * 4; q += 4) {
      out[q] = lut[0][px[q]]; out[q + 1] = lut[1][px[q + 1]]; out[q + 2] = lut[2][px[q + 2]]; out[q + 3] = 255;
    }
    return out;
  }

  // Countdown-dimmed trade window (see scan): every channel times gain.
  var DIM_GAIN = 4;
  var HALF_DIM_GAIN = 2.2;
  function brighten(px, w, h, gain) {
    var out = new Uint8Array(w * h * 4);
    for (var q = 0; q < w * h * 4; q += 4) {
      out[q] = Math.min(255, px[q] * gain); out[q + 1] = Math.min(255, px[q + 1] * gain);
      out[q + 2] = Math.min(255, px[q + 2] * gain); out[q + 3] = 255;
    }
    return out;
  }

  // Bounding boxes of 4-connected blobs in a 0/1 mask.
  function blobs(mask, w, h) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var out = [];
    for (var start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      var sp = 0, n = 0;
      var x0 = w, y0 = h, x1 = 0, y1 = 0;
      stack[sp++] = start; seen[start] = 1;
      while (sp) {
        var p = stack[--sp];
        var x = p % w, y = (p - x) / w;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      out.push({ x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, n: n });
    }
    return out;
  }

  function rowFraction(mask, w, y, xa, xb) {
    var hit = 0;
    for (var x = xa; x < xb; x++) if (mask[y * w + x]) hit++;
    return xb > xa ? hit / (xb - xa) : 0;
  }

  /**
   * px: RGBA bytes (canvas ImageData.data or a Uint8Array), w x h.
   * loose: photo mode (hue-based colours, tilted / patchy bars allowed).
   * Returns slots [{ x0, x1, nameTop, nameBottom, priceTop, inventory }] in px coordinates.
   */
  function findSlots(px, w, h, loose) {
    var green = new Uint8Array(w * h), pink = new Uint8Array(w * h);
    var greenAt = loose === 2 ? isGreenWide : loose ? isGreenLoose : isGreen;
    var pinkAt = loose === 2 ? isPinkWide : loose ? isPinkLoose : isPink;
    for (var i = 0, p = 0; i < w * h; i++, p += 4) {
      var r = px[p], g = px[p + 1], b = px[p + 2];
      if (greenAt(r, g, b)) green[i] = 1;
      else if (pinkAt(r, g, b)) pink[i] = 1;
    }
    var fill = loose ? 0.4 : 0.55;
    var slots = [];
    // One pink blob can be bars of different slots that touch: a big single
    // slot next to a smaller one (their bars at different heights), or
    // same-size slots in a row (split further below). Split where the bar's
    // top edge moves to a new height and stays there for at least a narrow
    // slot's width (24 px); a shorter dip is something drawn over the bar.
    function byTopEdge(bar) {
      // The last-try photo pass allows a bigger step: a tilted photo moves
      // the bar's top edge a few px partway along one slot (e595f3c3).
      var bh = bar.y1 - bar.y0, tol = Math.max(3, Math.round((loose === 2 ? 0.35 : 0.2) * bh));
      var tops = [], bottoms = [], counts = [];
      for (var x = bar.x0; x < bar.x1; x++) {
        var top = -1, bottom = -1, n = 0;
        for (var y = bar.y0; y < bar.y1; y++) {
          if (!pink[y * w + x]) continue;
          if (top < 0) top = y;
          bottom = y; n++;
        }
        tops.push(top); bottoms.push(bottom); counts.push(n);
      }
      function holds(i, level) {
        var run = 0;
        for (var j = i; j < tops.length && run < 24; j++) {
          if (tops[j] < 0) continue;
          if (Math.abs(tops[j] - level) > tol) return false;
          run++;
        }
        return run >= Math.min(24, tops.length - i);
      }
      var runs = [], cur = null, level = -1;
      for (var i = 0; i < tops.length; i++) {
        var t = tops[i];
        if (t >= 0 && level >= 0 && Math.abs(t - level) > tol) {
          if (holds(i, t)) cur = null;
          else { if (cur) cur.x1 = bar.x0 + i + 1; continue; }
        }
        if (!cur) { cur = { x0: bar.x0 + i, x1: bar.x0 + i + 1, y0: h, y1: 0, n: 0 }; runs.push(cur); }
        cur.x1 = bar.x0 + i + 1;
        if (t >= 0) { cur.y0 = Math.min(cur.y0, t); cur.y1 = Math.max(cur.y1, bottoms[i] + 1); cur.n += counts[i]; level = t; }
      }
      return runs.filter(function (run) { return run.n > 0; });
    }
    blobs(pink, w, h).forEach(function (blob) { byTopEdge(blob).forEach(oneBar); });
    function oneBar(bar) {
      var bw = bar.x1 - bar.x0, bh = bar.y1 - bar.y0;
      if (bw < 24 || bh < 4 || bw / bh < 3 || bw / bh > 56 || bar.n < fill * bw * bh) return;
      var xa = bar.x0 + Math.floor(bw / 8), xb = bar.x1 - Math.floor(bw / 8);
      // Walk up from the price bar to the bottom edge of the green name bar.
      // The search window scales with one slot's width: a bar of touching
      // slots (split below) is tried as 2-4 slots when 1 finds no name bar.
      var gBottom = -1, sw = bw;
      for (var n = 1; n <= 4 && gBottom < 0; n++) {
        sw = bw / n;
        var yStart = bar.y0 - Math.floor(0.3 * sw), yEnd = Math.max(0, bar.y0 - Math.floor(1.3 * sw));
        for (var y = yStart; y >= yEnd; y--) {
          if (rowFraction(green, w, y, xa, xb) > 0.35) { gBottom = y + 1; break; }
        }
      }
      if (gBottom < 0) return;
      var gTop = gBottom - 1;
      while (gTop > 0 && gBottom - gTop < sw && rowFraction(green, w, gTop - 1, xa, xb) > 0.35) gTop--;
      // Slots that touch (no dark gap, blurry video / photo) give one bar
      // for two or more slots: a slot is ~1.31 wide per name-to-price height
      // (696 YouTube slots), so split by that, at the weakest pink column.
      var k = Math.round((bar.x1 - bar.x0) / (bar.y0 - gTop) / SLOT_RATIO);
      var cuts = [bar.x0], wide = (bar.x1 - bar.x0) / (bar.y0 - gTop) > 1.8;
      // A bar too long for one slot (> 14 heights) only counts as 2-4 slots.
      if (bw / bh > 14 && !(wide && k >= 2 && k <= 4)) return;
      if (wide && k >= 2 && k <= 4) {
        var step = (bar.x1 - bar.x0) / k;
        for (var c = 1; c < k; c++) {
          var mid = Math.round(bar.x0 + c * step), span = Math.max(2, Math.floor(step / 8)), best = mid, low = 2;
          // Middle first, then outwards: no visible seam = the even split.
          for (var o = 0; o <= 2 * span; o++) {
            var x = mid + (o % 2 ? (o + 1) / 2 : -o / 2), hit = 0;
            for (var yy = bar.y0; yy < bar.y1; yy++) if (pink[yy * w + x]) hit++;
            if (hit / bh < low) { low = hit / bh; best = x; }
          }
          cuts.push(best);
        }
      }
      cuts.push(bar.x1);
      for (var s = 0; s + 1 < cuts.length; s++) {
        var slot = { x0: cuts[s], x1: cuts[s + 1], nameTop: gTop, nameBottom: gBottom, priceTop: bar.y0 };
        // Wide colours also catch HUD bars (green text over a purple bar) and
        // glow lines: keep only slot-shaped boxes (real slots are ~1.31 wide
        // per height) at least 8 % of the picture wide (a slot in a full phone
        // screenshot is ~10 %, in a monitor photo ~13 %; false hits were 3-6 %).
        var ratio = (slot.x1 - slot.x0) / (slot.priceTop - slot.nameTop);
        if (loose === 2 && (ratio < 1 || ratio > 1.9 || slot.x1 - slot.x0 < 0.08 * w)) continue;
        slot.inventory = hasPlusOverlay(px, w, slot);
        slots.push(slot);
      }
    }
    // Reading order. A tilted photo puts one row's bars a few px apart, so a
    // row is every slot whose name bar starts within two bar heights.
    slots.sort(function (m, n) { return m.nameTop - n.nameTop; });
    var rows = [];
    slots.forEach(function (sl) {
      var row = rows[rows.length - 1];
      if (row && sl.nameTop - row[0].nameTop < 2 * (row[0].nameBottom - row[0].nameTop)) row.push(sl);
      else rows.push([sl]);
    });
    return [].concat.apply([], rows.map(function (row) { return row.sort(function (m, n) { return m.x0 - n.x0; }); }));
  }

  // Your own inventory list (left panel while picking) draws a yellow "+" over
  // each fruit. Those are not part of the offer.
  function hasPlusOverlay(px, w, s) {
    var cx = (s.x0 + s.x1) / 2, cy = (s.nameBottom + s.priceTop) / 2;
    var size = Math.min(s.x1 - s.x0, s.priceTop - s.nameBottom);
    // Lines are a few px wide: look 2 px either side.
    function yellowAt(x, y) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          var p = (Math.round(y + dy) * w + Math.round(x + dx)) * 4;
          if (isYellow(px[p], px[p + 1], px[p + 2])) return 1;
        }
      }
      return 0;
    }
    var arms = 0, armN = 0, off = 0, offN = 0;
    for (var t = -0.16; t <= 0.16; t += 0.02) {
      arms += yellowAt(cx + t * size, cy) + yellowAt(cx, cy + t * size); armN += 2;
    }
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) {
      for (var k = 0.09; k <= 0.15; k += 0.03) { off += yellowAt(cx + d[0] * k * size, cy + d[1] * k * size); offN++; }
    });
    return arms / armN > 0.55 && off / offN < 0.2;
  }

  // In-game Items inventory (2026-11-08: 15 of 46 user reports). Each fruit
  // is a red (mythical) or purple (legendary) square tile with a lighter rim,
  // the fruit art, "Blox Fruit" at the top and the name at the bottom, on a
  // dark grid. No green / pink bars, so findSlots sees nothing. The gaps are
  // red-tinted too, but dark (value < 100).
  function isTileColor(r, g, b) {
    var c = hsv(r, g, b);
    return c[1] > 0.45 && c[2] > 110 && (c[0] < 15 || c[0] > 335 || (c[0] > 270 && c[0] <= 335));
  }

  function maskFill(mask, w, x0, y0, x1, y1) {
    var n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) n += mask[y * w + x];
    return n / Math.max(1, (x1 - x0) * (y1 - y0));
  }

  // Regular grid along one axis: tiles of one size with a thin gap, the gap
  // lines (no tile colour) at o + k * p. prof[i] = how empty line i is.
  // Fruit art leaves dips inside a tile too, so the whole grid is fitted at
  // once rather than cut at every dip. Returns [[a, b)] tile spans inside
  // [lo, hi) with at least 40 % of a tile showing (the name is at the
  // bottom: a tile cut at the list top still shows it).
  function fitGrid(prof, lo, hi, size) {
    // Each line is scored with a small triangle around it, so the fit lands
    // on the middle of a gap (a gap is a few lines wide and evenly dark).
    var hw = Math.max(2, Math.round(0.03 * size)), sm = [];
    for (var i = 0; i < prof.length; i++) {
      var acc = 0;
      for (var j = -hw; j <= hw; j++) if (i + j >= 0 && i + j < prof.length) acc += prof[i + j] * (hw + 1 - Math.abs(j));
      sm.push(acc);
    }
    var best = -1, bp = 0, bo = 0;
    for (var p = Math.round(size); p <= Math.round(1.12 * size) + 1; p++) {
      for (var o = 0; o < p; o++) {
        var sum = 0, n = 0;
        for (var at = o; at < prof.length; at += p) { sum += sm[at]; n++; }
        if (n && sum / n > best) { best = sum / n; bp = p; bo = o; }
      }
    }
    var g = Math.max(2, bp - size) / 2, out = [];
    for (var at2 = bo - bp; at2 < prof.length; at2 += bp) {
      var a = Math.max(lo, Math.round(at2 + g)), b = Math.min(hi, Math.round(at2 + bp - g));
      if (b - a >= 0.4 * size) out.push([a, b]);
    }
    return out;
  }

  /**
   * Inventory tiles as slots: the whole tile is the picture (nameBottom =
   * the tile top, priceTop = the tile bottom; what the model reads), and
   * inventory: true, tile: true. A tile cut by the scrolling list is boxed
   * as a full square (the model learned whole tiles); one with less than
   * half showing is dropped. [] when the picture is not an inventory.
   */
  function findInventoryTiles(px, w, h) {
    var mask = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) if (isTileColor(px[p], px[p + 1], px[p + 2])) mask[i] = 1;
    var big = blobs(mask, w, h).filter(function (b) { return b.x1 - b.x0 >= 0.03 * w && b.y1 - b.y0 >= 0.015 * w; });
    function inside(b, c) { var cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2; return c !== b && cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1; }
    // One tile on its own: square, or cut by the list edge (at least half).
    // Not a ring of tile colour around other tiles (several tiles joined by
    // blur or by fruit art over a gap, with more tiles inside).
    // Its rim is tile colour most of the way round (a piece of art is not).
    // A band just inside the box: a photo blurs the outermost pixels.
    function rim(b) {
      var t = 3, i = Math.min(2, Math.floor((b.x1 - b.x0) / 20)), x0 = b.x0 + i, y0 = b.y0 + i, x1 = b.x1 - i, y1 = b.y1 - i;
      var area = 2 * t * (x1 - x0) + 2 * t * (y1 - y0 - 2 * t);
      var n = maskFill(mask, w, x0, y0, x1, y0 + t) * t * (x1 - x0) + maskFill(mask, w, x0, y1 - t, x1, y1) * t * (x1 - x0) +
        maskFill(mask, w, x0, y0 + t, x0 + t, y1 - t) * t * (y1 - y0 - 2 * t) + maskFill(mask, w, x1 - t, y0 + t, x1, y1 - t) * t * (y1 - y0 - 2 * t);
      return n / area;
    }
    var singles = big.filter(function (b) {
      var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      return bw >= 0.05 * w && bh >= 0.5 * bw && bh <= 1.15 * bw && b.n >= 0.15 * bw * bh && rim(b) >= 0.5 &&
        big.filter(function (c) { return inside(b, c) && c.x1 - c.x0 >= 0.2 * bw; }).length < 2;
    });
    // The tile size: the width most single tiles agree on, bigger ones
    // weighing a little more (a few tiles outweigh many small pieces of art;
    // two tiles outweigh one blob of two joined tiles).
    var size = 0, bestScore = 0;
    singles.forEach(function (c) {
      var s = c.x1 - c.x0, score = 0;
      singles.forEach(function (d) { if (Math.abs(d.x1 - d.x0 - s) <= 0.12 * s) score += Math.sqrt(d.x1 - d.x0); });
      if (score > bestScore || (score === bestScore && s > size)) { bestScore = score; size = s; }
    });
    if (!size) return [];
    // The grid's extent: blobs one or more tiles wide (k tiles + gaps).
    var box = null;
    big.forEach(function (d) {
      var bw = d.x1 - d.x0, k = Math.max(1, Math.round(bw / (1.04 * size)));
      if (k > 6 || Math.abs(bw - k * 1.04 * size + 0.04 * size) > 0.2 * size || d.y1 - d.y0 < 0.4 * size) return;
      box = box ? { x0: Math.min(box.x0, d.x0), y0: Math.min(box.y0, d.y0), x1: Math.max(box.x1, d.x1), y1: Math.max(box.y1, d.y1) } : { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 };
    });
    if (!box) return [];
    // Gap-ness of each column / row across the grid, with a margin so the
    // outer gap lines are inside the profile: how far the line's mean
    // brightness dips below the bright tile rims either side of it. A
    // screenshot's gap is near black; a photo blurs it to a darker red, but
    // it still sits in a valley between two rims.
    var m = Math.round(0.1 * size);
    var gx0 = Math.max(0, box.x0 - m), gx1 = Math.min(w, box.x1 + m), gy0 = Math.max(0, box.y0 - m), gy1 = Math.min(h, box.y1 + m);
    function valleys(v) {
      var d = Math.max(2, Math.round(0.05 * size)), out = [];
      for (var k = 0; k < v.length; k++) {
        var l = 0, r = 0;
        for (var j = Math.max(0, k - d); j < k; j++) l = Math.max(l, v[j]);
        for (var j2 = k + 1; j2 <= Math.min(v.length - 1, k + d); j2++) r = Math.max(r, v[j2]);
        out.push(Math.max(0, Math.min(l, r) - v[k]) / 255);
      }
      return out;
    }
    function bright(x0, y0, x1, y1) {
      var sum = 0;
      for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) { var q = (yy * w + xx) * 4; sum += Math.max(px[q], px[q + 1], px[q + 2]); }
      return sum / Math.max(1, (x1 - x0) * (y1 - y0));
    }
    var colV = [], rowV = [];
    for (var x = gx0; x < gx1; x++) colV.push(bright(x, box.y0, x + 1, box.y1));
    for (var y = gy0; y < gy1; y++) rowV.push(bright(box.x0, y, box.x1, y + 1));
    var colProf = valleys(colV), rowProf = valleys(rowV);
    // A tile standing alone is the surest evidence of where the grid lines
    // are (one row, or a gap the valleys cannot see): its edges count too.
    // Top / bottom only for a whole tile; a cut one ends at the list edge.
    singles.forEach(function (b) {
      if (Math.abs(b.x1 - b.x0 - size) > 0.12 * size) return;
      [b.x0 - 1, b.x1].forEach(function (x) { if (x >= gx0 && x < gx1) colProf[x - gx0] += 0.5; });
      if (b.y1 - b.y0 < 0.9 * size) return;
      [b.y0 - 1, b.y1].forEach(function (y) { if (y >= gy0 && y < gy1) rowProf[y - gy0] += 0.5; });
    });
    var cols = fitGrid(colProf, box.x0 - gx0, box.x1 - gx0, size), rows = fitGrid(rowProf, box.y0 - gy0, box.y1 - gy0, size);
    var tiles = [];
    rows.forEach(function (r) {
      cols.forEach(function (c) {
        var t = { x0: gx0 + c[0], x1: gx0 + c[1], y0: gy0 + r[0], y1: gy0 + r[1] };
        // An empty grid place (the list's last row) has no tile colour.
        if (maskFill(mask, w, t.x0, t.y0, t.x1, t.y1) >= 0.2) tiles.push(t);
      });
    });
    // The inventory packs tiles side by side: most grid places hold one.
    // Scattered red badges (another app's list, 2026-11-06 report) do not.
    if (tiles.length < 0.5 * rows.length * cols.length) return [];
    var full = tiles.filter(function (b) { return b.y1 - b.y0 >= 0.85 * size; });
    // A grid of at least two tiles, or one tile filling the picture (a
    // single tile cropped out).
    if (!full.length || (tiles.length < 2 && size < 0.35 * Math.min(w, h))) return [];
    var mid = full.map(function (b) { return (b.y0 + b.y1) / 2; }).sort(function (q, n) { return q - n; })[Math.floor(full.length / 2)];
    // Reading order: rows top to bottom, each left to right (already so).
    return tiles.map(function (b) {
      var y0 = b.y0, y1 = b.y1;
      if (y1 - y0 < 0.85 * size) {
        // Cut by the list edge: above the grid's middle it lost its top
        // (the name at the bottom shows); below, its bottom, and with it the
        // name: only "Blox Fruit" and the top of the art unless most shows.
        if ((y0 + y1) / 2 < mid) y0 = Math.max(0, y1 - size);
        else if (y1 - y0 < 0.6 * size) return null;
        else y1 = Math.min(h, y0 + size);
      }
      return { x0: b.x0, x1: b.x1, nameTop: y0, nameBottom: y0, priceTop: y1, inventory: true, tile: true };
    }).filter(Boolean);
  }

  /** Signature of the picture between a slot's name bar and price bar. */
  function slotSignature(px, w, s) {
    var pad = Math.max(2, Math.floor((s.x1 - s.x0) / 30));
    var x0 = s.x0 + pad, x1 = s.x1 - pad, y0 = s.nameBottom + pad, y1 = s.priceTop - pad;
    if (x1 - x0 < 8 || y1 - y0 < 8) return null;
    // Panel colour = median of the border pixels.
    var rs = [], gs = [], bs = [];
    function take(x, y) { var p = (y * w + x) * 4; rs.push(px[p]); gs.push(px[p + 1]); bs.push(px[p + 2]); }
    for (var x = x0; x < x1; x++) { take(x, y0); take(x, y0 + 1); take(x, y1 - 1); take(x, y1 - 2); }
    for (var y = y0; y < y1; y++) { take(x0, y); take(x0 + 1, y); take(x1 - 1, y); take(x1 - 2, y); }
    function med(a) { a.sort(function (m, n) { return m - n; }); return a[Math.floor(a.length / 2)]; }
    var bg = [med(rs), med(gs), med(bs)];
    // Foreground mask and its bounding box.
    var cw = x1 - x0, ch = y1 - y0;
    var fg = new Uint8Array(cw * ch);
    var bx0 = cw, by0 = ch, bx1 = -1, by1 = -1;
    for (var yy = 0; yy < ch; yy++) {
      for (var xx = 0; xx < cw; xx++) {
        var p = ((y0 + yy) * w + x0 + xx) * 4;
        var d = Math.abs(px[p] - bg[0]) + Math.abs(px[p + 1] - bg[1]) + Math.abs(px[p + 2] - bg[2]);
        if (d > 60 && !isPanel(px[p], px[p + 1], px[p + 2]) && !isGreen(px[p], px[p + 1], px[p + 2])) {
          fg[yy * cw + xx] = 1;
          if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx;
          if (yy < by0) by0 = yy; if (yy > by1) by1 = yy;
        }
      }
    }
    if (bx1 < 0) return null;
    return boxSignature(function (gx, gy) {
      var q = ((y0 + gy) * w + x0 + gx) * 4;
      return [px[q], px[q + 1], px[q + 2], fg[gy * cw + gx]];
    }, bx0, by0, bx1 + 1, by1 + 1);
  }

  // Box-filter a content box (padded to a square) down to N x N. get(x, y)
  // returns [r, g, b, alpha 0..1]. Same method as build_signatures.py.
  function boxSignature(get, bx0, by0, bx1, by1) {
    var bw = bx1 - bx0, bh = by1 - by0, s = Math.max(bw, bh);
    var ox = bx0 - (s - bw) / 2, oy = by0 - (s - bh) / 2;
    var rgb = new Float32Array(N * N * 3), a = new Float32Array(N * N);
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var sx0 = Math.floor(ox + (i * s) / N), sx1 = Math.max(sx0 + 1, Math.floor(ox + ((i + 1) * s) / N));
        var sy0 = Math.floor(oy + (j * s) / N), sy1 = Math.max(sy0 + 1, Math.floor(oy + ((j + 1) * s) / N));
        var r = 0, g = 0, b = 0, al = 0, cnt = 0;
        for (var y = sy0; y < sy1; y++) {
          for (var x = sx0; x < sx1; x++) {
            var v = (x >= bx0 && x < bx1 && y >= by0 && y < by1) ? get(x, y) : null;
            var k = v ? v[3] : 0;
            r += v ? v[0] * k + BG[0] * (1 - k) : BG[0];
            g += v ? v[1] * k + BG[1] * (1 - k) : BG[1];
            b += v ? v[2] * k + BG[2] * (1 - k) : BG[2];
            al += k; cnt++;
          }
        }
        var o = j * N + i;
        rgb[o * 3] = r / cnt; rgb[o * 3 + 1] = g / cnt; rgb[o * 3 + 2] = b / cnt; a[o] = al / cnt;
      }
    }
    return { rgb: rgb, a: a, hue: hueHist(rgb, a) };
  }

  function hueHist(rgb, a) {
    var hs = new Float32Array(12), total = 0;
    for (var o = 0; o < N * N; o++) {
      if (a[o] < 0.5) continue;
      var r = rgb[o * 3] / 255, g = rgb[o * 3 + 1] / 255, b = rgb[o * 3 + 2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      var sat = mx ? d / mx : 0;
      if (sat < 0.25 || mx < 0.2) continue;
      var hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh = (hh / 6 + 1) % 1;
      hs[Math.floor(hh * 12) % 12] += sat; total += sat;
    }
    for (var k = 0; k < 12; k++) hs[k] = total ? hs[k] / total : 0;
    return hs;
  }

  function distance(q, t) {
    var num = 0, den = 0, shape = 0, hue = 0;
    for (var o = 0; o < N * N; o++) {
      var m = Math.max(q.a[o], t.a[o]);
      num += m * (Math.abs(q.rgb[o * 3] - t.rgb[o * 3]) + Math.abs(q.rgb[o * 3 + 1] - t.rgb[o * 3 + 1]) + Math.abs(q.rgb[o * 3 + 2] - t.rgb[o * 3 + 2]));
      den += m;
      shape += Math.abs(q.a[o] - t.a[o]);
    }
    for (var k = 0; k < 12; k++) hue += Math.abs(q.hue[k] - t.hue[k]);
    return num / (den * 765 + 1e-6) + 0.5 * (shape / (N * N)) + 0.2 * hue;
  }

  function decodeBase64(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  /** fruitSignatures.json -> [{ name, rgb, a, hue }] */
  function loadTemplates(json) {
    return json.items.map(function (it) {
      var raw = decodeBase64(it.sig);
      var rgb = new Float32Array(N * N * 3), a = new Float32Array(N * N);
      for (var o = 0; o < N * N; o++) {
        rgb[o * 3] = raw[o * 4]; rgb[o * 3 + 1] = raw[o * 4 + 1]; rgb[o * 3 + 2] = raw[o * 4 + 2]; a[o] = raw[o * 4 + 3] / 255;
      }
      return { name: it.name, rgb: rgb, a: a, hue: hueHist(rgb, a) };
    });
  }

  function rank(sig, templates, top) {
    return templates
      .map(function (t) { return { name: t.name, d: Math.round(distance(sig, t) * 1000) / 1000 }; })
      .sort(function (m, n) { return m.d - n.d; })
      .slice(0, top || 5);
  }

  /**
   * Full pass: slots with their picture candidates, best first. A screenshot
   * is read as is; when the colour-normalised photo pass finds more slots
   * (camera shot of a PC screen) that one is used.
   */
  function scan(px, w, h, templates) {
    var src = px, slots = findSlots(px, w, h, false), photo = false;
    var norm = normalizeColors(px, w, h);
    var loose = findSlots(norm, w, h, true);
    if (loose.length > slots.length) { src = norm; slots = loose; photo = true; }
    // Both sides "Ready!": the game darkens the window for the 5 s countdown
    // (bars at ~25 %, pink ~(54,2,51)), and the rest of the screen stays
    // bright, so the levels stretch does not lift it. Nothing found: once
    // more with the picture brightened.
    if (!slots.length) {
      var bright = brighten(px, w, h, DIM_GAIN);
      var dim = findSlots(bright, w, h, false);
      if (dim.length) { src = bright; slots = dim; }
    }
    // One side dimmed: until the other player is ready the game shows their
    // side at ~45 % (16b8dba1, 2026-11-10: pink bars ~(90,0,90)), so only the
    // bright side was found. Brightened, the dim side's slots show: add the
    // new ones that match the found slots' size and sit level with one of
    // their rows (the two offers' rows line up). Each is signed from the
    // brightened picture.
    var extra = [], brightSrc = null;
    if (slots.length && slots.length < 8) {
      brightSrc = brighten(px, w, h, HALF_DIM_GAIN);
      var sz = slots.map(function (s) { return s.x1 - s.x0; }).sort(function (a, b) { return a - b; });
      var mid = sz[Math.floor(sz.length / 2)];
      findSlots(brightSrc, w, h, false).forEach(function (d) {
        var dw = d.x1 - d.x0;
        if (Math.abs(dw - mid) > 0.15 * mid) return;
        if (slots.concat(extra).some(function (s) { return Math.min(s.x1, d.x1) - Math.max(s.x0, d.x0) > 0 && Math.min(s.priceTop, d.priceTop) - Math.max(s.nameTop, d.nameTop) > 0; })) return;
        if (!slots.some(function (s) { return Math.abs(s.nameTop - d.nameTop) < 0.2 * mid; })) return;
        extra.push(d);
      });
    }
    // Still nothing: wider photo colours (washed-out monitor photo).
    if (!slots.length) {
      var wide = findSlots(norm, w, h, 2);
      if (wide.length) { src = norm; slots = wide; photo = true; }
    }
    // Still nothing: the in-game Items inventory (no trade window at all).
    if (!slots.length) {
      var inv = findInventoryTiles(px, w, h);
      var invNorm = findInventoryTiles(norm, w, h);
      if (invNorm.length > inv.length) { src = norm; slots = invNorm; photo = true; } else slots = inv;
    }
    var sign = function (from) {
      return function (s) {
        var sig = slotSignature(from, w, s);
        s.candidates = sig ? rank(sig, templates, 5) : [];
        s.photo = photo;
        return s;
      };
    };
    var out = slots.map(sign(src));
    if (extra.length) out = out.concat(extra.map(sign(brightSrc))).sort(function (a, b) { return Math.abs(a.nameTop - b.nameTop) < 0.2 * (a.x1 - a.x0) ? a.x0 - b.x0 : a.nameTop - b.nameTop; });
    return out;
  }

  var api = { N: N, findSlots: findSlots, findInventoryTiles: findInventoryTiles, normalizeColors: normalizeColors, slotSignature: slotSignature, loadTemplates: loadTemplates, rank: rank, scan: scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeMatcher = api;
})(this);
