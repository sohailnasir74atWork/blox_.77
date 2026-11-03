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
    var greenAt = loose ? isGreenLoose : isGreen, pinkAt = loose ? isPinkLoose : isPink;
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
      var bh = bar.y1 - bar.y0, tol = Math.max(3, Math.round(0.2 * bh));
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
    return slots.map(function (s) {
      var sig = slotSignature(src, w, s);
      s.candidates = sig ? rank(sig, templates, 5) : [];
      s.photo = photo;
      return s;
    });
  }

  var api = { N: N, findSlots: findSlots, normalizeColors: normalizeColors, slotSignature: slotSignature, loadTemplates: loadTemplates, rank: rank, scan: scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeMatcher = api;
})(this);
