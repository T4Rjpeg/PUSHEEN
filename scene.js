'use strict';
  // ===================== SCENE: a doodled garden under Mount Fuji, her house, real time & season =====================
  var SCENE = (function () {
    var HOUR_OVERRIDE = null, SEASON_OVERRIDE = null, SUN = null, WX = null, EVENTS = [];
    // the sky follows the real sunrise and sunset where you are (when the phone knows)
    function skyHour() {
      var h = hourNow(); if (HOUR_OVERRIDE != null || !SUN) return h;
      var r = SUN.rise, st = SUN.set; if (!(r > 3 && r < 10.5 && st > 15 && st < 23)) return h;
      if (h < r) return h / r * 6.2;
      if (h < st) return 6.2 + (h - r) / (st - r) * 12.4;
      return 18.6 + (h - st) / (24 - st) * 5.4;
    }
    function wxKind() {
      if (EVENTS.indexOf('typhoon') >= 0) { var hh = hourNow(); if (hh >= 9 && hh < 22) return 'storm'; }
      if (!WX || WX.code == null) return null; var c = WX.code;
      return c >= 95 ? 'storm' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 51 && c <= 57 ? 'drizzle' : (c >= 61 && c <= 67) || (c >= 80 && c <= 82) ? 'rain' : c === 45 || c === 48 ? 'fog' : c === 3 ? 'cloudy' : c === 2 ? 'partly' : null;
    }
    var GREY = { partly: 0.12, cloudy: 0.45, drizzle: 0.45, rain: 0.55, storm: 0.72, fog: 0.5, snow: 0.38 };
    function hourNow() { if (HOUR_OVERRIDE != null) return HOUR_OVERRIDE; var d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
    function season() {
      if (SEASON_OVERRIDE) return SEASON_OVERRIDE;
      var m = new Date().getMonth();
      return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
    }
    function rng(seed) { var s = (seed * 2654435761) >>> 0 || 7; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1000003) / 1000003; }; }
    function hexA(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    function rgb(a, al) { return al == null ? 'rgb(' + a.map(Math.round).join(',') + ')' : 'rgba(' + a.map(Math.round).join(',') + ',' + al + ')'; }
    function mix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    function sm(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

    // ---------- the world (same units as her rig: she is ~1250 tall, her shadow sits at y=1282) ----------
    var INK = '#5b4944', FENCE_BASE = 1132, FENCE_TOP = 1000, LAKE_TOP = 880, FLOOR = 1120;
    var BOUNDS = { garden: [-1750, 3450], house: [-640, 1960] };
    var HOUSE = { x: 2200, w: 900, base: FENCE_BASE + 70 };
    HOUSE.door = HOUSE.x + 300 + 90;
    var C = {
      fuji: '#aebbe1', fujiShade: '#9ba9d4', snow: '#ffffff', hills: '#cdd5ee', shore: '#bfdcae', pine: '#94c191', pine2: '#80b380',
      lake: '#acd8ef', wave: '#82bad9', trunk: '#c59b7a', bamboo: '#acd78e', node: '#87b96d', fence: '#efd9a0', fenceNode: '#d6b878',
      rail: '#c79f6f', rope: '#8a6a55', grass: '#c3e3a6', sand: '#f6eedd', rake: '#e4d6bb', stone: '#d6d0c9', stoneDark: '#c0b8ae',
      moss: '#b9d99a', lantern: '#dcd6ce', wall: '#fff4e1', wood: '#d8ae86', woodDark: '#b98c66', roof: '#a0b1dd', roofDark: '#8a9acb',
      shoji: '#fffaf0', pot: '#eaa985', potBlue: '#a9bee4', pond: '#b6def2', koi: '#ffa46e', tatami: '#ebe4bd', tatamiEdge: '#9cb38a',
      roomWall: '#fbeedd', wains: '#e6c9a3'
    };
    var FOL = {
      spring: { leaf: ['#f9c9d8', '#fbdbe5', '#f3b2c7'], bush: ['#b9dc9c', '#f7c2d3'], shore: ['#f6c6d6', '#bfdcae'], fall: 'petal' },
      summer: { leaf: ['#a8d891', '#bfe3a8', '#94cb80'], bush: ['#a3d48c', '#bde3a5'], shore: ['#a7d49a', '#94c191'], fall: null },
      autumn: { leaf: ['#f6a46f', '#f9c56f', '#ee8a63'], bush: ['#eca36d', '#f6c477'], shore: ['#f3ae78', '#f6cd7a'], fall: 'leaf' },
      winter: { leaf: ['#eef3f8', '#ffffff', '#dfe7f0'], bush: ['#dde7ee', '#f4f8fb'], shore: ['#e4ecf3', '#c9d9d0'], fall: 'snow' }
    };
    var SNOWLINE = { spring: 0.42, summer: 0.14, autumn: 0.3, winter: 0.56 };

    // ---------- doodle builder: wobbly hand-drawn paths baked into Path2D groups ----------
    function Builder(seed) { this.R = rng(seed); this.groups = []; this.cur = null; this.box = [1e9, 1e9, -1e9, -1e9]; }
    Builder.prototype.wob = function (pts, amp, closed) {
      var R = this.R, out = [], n = pts.length, segs = closed ? n : n - 1;
      for (var i = 0; i < segs; i++) {
        var a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / 42));
        for (var j = 0; j < k; j++) { var u = j / k; out.push([a[0] + (b[0] - a[0]) * u + (R() - 0.5) * amp, a[1] + (b[1] - a[1]) * u + (R() - 0.5) * amp]); }
      }
      if (!closed) out.push(pts[n - 1].slice());
      return out;
    };
    Builder.prototype.add = function (pts, o) {
      o = o || {};
      var closed = o.closed !== false, amp = o.wob == null ? 5 : o.wob;
      var p = amp ? this.wob(pts, amp, closed) : pts;
      var key = (o.fill || '') + '|' + (o.stroke === false ? '' : o.stroke || INK) + '|' + (o.lw || 1) + '|' + (o.mode || 'solo') + '|' + (o.g || Math.random());
      if (!this.cur || this.cur.key !== key) {
        this.cur = { key: key, path: new Path2D(), fill: o.fill || null, stroke: o.stroke === false ? null : o.stroke || INK, lw: o.lw || 1, mode: o.mode || 'solo', alpha: o.alpha || 1 };
        this.groups.push(this.cur);
      }
      var P = this.cur.path, b = this.box;
      p.forEach(function (q) { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1]; });
      if (closed) {
        var m0 = [(p[p.length - 1][0] + p[0][0]) / 2, (p[p.length - 1][1] + p[0][1]) / 2]; P.moveTo(m0[0], m0[1]);
        for (var i = 0; i < p.length; i++) { var q = p[i], r = p[(i + 1) % p.length]; P.quadraticCurveTo(q[0], q[1], (q[0] + r[0]) / 2, (q[1] + r[1]) / 2); }
        P.closePath();
      } else {
        P.moveTo(p[0][0], p[0][1]);
        for (var k = 1; k < p.length - 1; k++) P.quadraticCurveTo(p[k][0], p[k][1], (p[k][0] + p[k + 1][0]) / 2, (p[k][1] + p[k + 1][1]) / 2);
        P.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      }
      return this;
    };
    Builder.prototype.ell = function (cx, cy, rx, ry, o) {
      var n = Math.max(10, Math.min(28, Math.round((rx + ry) / 14))), pts = [], irr = (o && o.irr) || 0.06, R = this.R;
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, r = 1 + (R() - 0.5) * irr; pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]); }
      return this.add(pts, Object.assign({ wob: 0 }, o));
    };
    Builder.prototype.rect = function (x, y, w, h, o) { return this.add([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o); };
    Builder.prototype.line = function (pts, o) { return this.add(pts, Object.assign({ closed: false, wob: 3 }, o)); };
    Builder.prototype.canopy = function (cx, cy, r, cols, o) {
      // a fluffy cloud-like tree crown: lobes merged into one outline, then lighter puffs on top
      var R = this.R, n = 6 + Math.floor(R() * 3), g = 'cn' + Math.floor(R() * 1e6);
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2 + R(), d = r * (0.42 + R() * 0.2); this.ell(cx + Math.cos(a) * d * 1.1, cy + Math.sin(a) * d * 0.75, r * (0.5 + R() * 0.18), r * (0.45 + R() * 0.15), { fill: cols[0], mode: 'merge', g: g }); }
      this.ell(cx, cy, r * 0.62, r * 0.55, { fill: cols[0], mode: 'merge', g: g });
      for (var j = 0; j < 3; j++) this.ell(cx - r * 0.35 + R() * r * 0.5, cy - r * 0.35 + R() * r * 0.2, r * (0.16 + R() * 0.1), r * (0.12 + R() * 0.08), { fill: cols[1], stroke: false, g: g + 'h' });
      if (o && o.dots) for (var k = 0; k < 5; k++) this.ell(cx + (R() - 0.5) * r * 1.4, cy + (R() - 0.5) * r * 0.9, 7, 7, { fill: cols[2], stroke: false, g: g + 'd' });
      return this;
    };
    function cloudPts(cx, cy, w, h, R) {
      var pts = [], lobes = 4 + Math.floor(R() * 3);
      pts.push([cx + w / 2, cy]); pts.push([cx - w / 2, cy]);
      for (var i = 0; i <= lobes; i++) {
        var u = i / lobes, x = cx - w / 2 + u * w, top = cy - h * (0.45 + 0.55 * Math.sin(Math.PI * u)) * (0.75 + R() * 0.35);
        pts.push([x - w / lobes * 0.25, (cy + top) / 2]); pts.push([x, top]); pts.push([x + w / lobes * 0.25, (cy + top) / 2]);
      }
      pts.splice(2, 1); pts.pop();
      return pts;
    }

    // ---------- layers (depth d: 0 = stuck to the screen, 1 = moves with her ground) ----------
    var layers = {}, owned = {}, builtKey = '';
    function build() {
      var sea = season(), F = FOL[sea], key = sea + '|' + JSON.stringify(owned);
      if (key === builtKey) return; builtKey = key;
      layers.fuji = buildFuji(sea); layers.lake = buildLake(F); layers.mid = buildMid(F, sea); layers.ground = buildGround(F, sea); layers.room = buildRoom();
    }
    function buildFuji(sea) {
      var b = new Builder(11), R = b.R, base = LAKE_TOP + 60, x0 = 980, H = 760, W = 1300, top = base - H;
      // distant lavender hills
      var hp = [[-6000, base + 200], [-6000, base - 120]];
      for (var x = -6000; x <= 7000; x += 260) hp.push([x, base - 250 - 90 * Math.sin(x * 0.0021) - 50 * Math.sin(x * 0.0057 + 1) - R() * 20]);
      hp.push([7000, base + 200]);
      b.add(hp, { fill: C.hills, mode: 'merge', wob: 6 });
      // Fuji: concave slopes, flat crater top
      var prof = function (side) { var out = []; for (var i = 0; i <= 10; i++) { var u = i / 10; out.push([x0 + side * (70 + (W - 70) * u), top + H * Math.pow(u, 0.62)]); } return out; };
      var L = prof(-1).reverse(), Rr = prof(1);
      b.add(L.concat([[x0 - 30, top - 6], [x0 + 30, top - 4]]).concat(Rr).concat([[x0 + W, base + 200], [x0 - W, base + 200]]), { fill: C.fuji, wob: 4 });
      // shaded left flank
      b.add([[x0 - 60, top + 8], [x0 - 300, base], [x0 - W + 40, base], [x0 - W * 0.7, top + H * 0.75]].concat(prof(-1).slice(2, 8).reverse().map(function (p) { return [p[0] + 6, p[1] + 2]; })), { fill: C.fujiShade, stroke: false, wob: 3 });
      // snow cap with rounded drips
      var sl = SNOWLINE[sea], yS = top + H * sl, cap = [];
      var edge = function (side) { var out = []; for (var i = 0; i <= 6; i++) { var y = top + (yS - top) * i / 6, u = Math.pow((y - top) / H, 1 / 0.62); out.push([x0 + side * (70 + (W - 70) * u), y]); } return out; };
      var le = edge(-1), re = edge(1), xl = le[le.length - 1][0], xr = re[re.length - 1][0];
      cap = le.slice().reverse().concat([[x0 - 30, top - 6], [x0 + 30, top - 4]]).concat(re);
      var drips = 7 + Math.floor((xr - xl) / 180);
      for (var d = 1; d < drips; d++) {
        var xx = xr - (xr - xl) * d / drips, dy = (d % 2 ? 1 : -0.3) * (40 + R() * 70) * Math.max(0.35, sl * 2);
        cap.push([xx + 25, yS + dy * 0.55]); cap.push([xx, yS + dy]); cap.push([xx - 25, yS + dy * 0.55]);
      }
      b.add(cap, { fill: C.snow, wob: 4 });
      if (sea !== 'summer') b.line([[x0 - 160, top + 120], [x0 - 230, top + 210]], { stroke: '#c9d3ee', lw: 1.2 }).line([[x0 + 140, top + 110], [x0 + 190, top + 190]], { stroke: '#c9d3ee', lw: 1.2 });
      // a scarf of mist around Fuji's feet
      for (var m = 0; m < 9; m++) { var cx = x0 - 1500 + m * 380 + R() * 120; b.add(cloudPts(cx, base - 30 + R() * 30, 360 + R() * 200, 90 + R() * 40, R), { fill: '#ffffff', mode: 'merge', g: 'mist', wob: 3 }); }
      return { d: 0.18, groups: b.groups };
    }
    function buildLake(F) {
      var b = new Builder(23), R = b.R;
      // far shore: a green hill band and little lollipop + pine trees
      var sp = [[-6000, LAKE_TOP + 40], [-6000, LAKE_TOP - 40]];
      for (var x = -6000; x <= 7000; x += 200) sp.push([x, LAKE_TOP - 50 - 30 * Math.sin(x * 0.004) - R() * 18]);
      sp.push([7000, LAKE_TOP + 40]);
      b.add(sp, { fill: C.shore, mode: 'merge', wob: 5 });
      for (var t = -6000; t <= 7000; t += 62 + R() * 40) {
        var y = LAKE_TOP - 24 - R() * 30, h = 70 + R() * 50;
        if (R() < 0.45) b.add([[t, y + 6], [t - h * 0.32, y], [t - h * 0.2, y - h * 0.45], [t - h * 0.26, y - h * 0.42], [t, y - h], [t + h * 0.26, y - h * 0.42], [t + h * 0.2, y - h * 0.45], [t + h * 0.32, y]], { fill: R() < 0.5 ? C.pine : C.pine2, g: 'pines', wob: 2 });
        else b.ell(t, y - h * 0.38, h * 0.32, h * 0.36, { fill: F.shore[R() < 0.6 ? 0 : 1], g: 'pops', irr: 0.12 });
      }
      // the water
      b.rect(-6000, LAKE_TOP, 13000, FENCE_TOP - LAKE_TOP + 140, { fill: C.lake, wob: 3 });
      for (var w = 0; w < 140; w++) {
        var wx = -5000 + R() * 11000, wy = LAKE_TOP + 18 + R() * (FENCE_TOP - LAKE_TOP - 10), ww = 26 + R() * 30;
        b.line([[wx - ww, wy], [wx - ww / 2, wy - 7], [wx, wy], [wx + ww / 2, wy - 7], [wx + ww, wy]], { stroke: C.wave, lw: 0.9, g: 'waves', wob: 1 });
      }
      return { d: 0.45, groups: b.groups };
    }
    function buildMid(F, sea) {
      var b = new Builder(37), R = b.R;
      [-2500, -1350, -420, 1150, 2050, 3150, 4200].forEach(function (x, i) {
        var bx = x + (R() - 0.5) * 120, by = FENCE_TOP + 60, h = 330 + R() * 120;
        b.add([[bx - 22, by], [bx - 14, by - h * 0.6], [bx - 40, by - h * 0.85], [bx - 10, by - h * 0.7], [bx + 4, by - h], [bx + 16, by - h * 0.62], [bx + 24, by]], { fill: C.trunk, wob: 3 });
        b.canopy(bx, by - h - 30, 150 + R() * 50, [F.leaf[0], F.leaf[1], F.leaf[2]], { dots: sea === 'spring' || sea === 'autumn' });
        if (i % 2) b.canopy(bx + 120, by - h + 50, 95, [F.leaf[2], F.leaf[1], F.leaf[0]]);
      });
      [-1900, -800, 650, 2900].forEach(function (x) {
        for (var s = 0; s < 6; s++) {
          var sx = x + s * 34 + (R() - 0.5) * 12, h = 380 + R() * 220, y0 = FENCE_TOP + 60;
          b.rect(sx, y0 - h, 22, h, { fill: C.bamboo, g: 'bam', wob: 2 });
          for (var n = 1; n < 5; n++) b.line([[sx, y0 - h * n / 5], [sx + 22, y0 - h * n / 5]], { stroke: C.node, lw: 1, g: 'bamn', wob: 1 });
          for (var l = 0; l < 3; l++) { var ly = y0 - h + 30 + R() * h * 0.5, side = R() < 0.5 ? -1 : 1; b.add([[sx + 11, ly], [sx + 11 + side * 34, ly - 14], [sx + 11 + side * 60, ly - 4], [sx + 11 + side * 30, ly + 4]], { fill: C.bamboo, g: 'baml', wob: 2 }); }
        }
      });
      return { d: 0.75, groups: b.groups };
    }
    function buildGround(F, sea) {
      var b = new Builder(53), R = b.R, X0 = BOUNDS.garden[0] - 2200, X1 = BOUNDS.garden[1] + 2200;
      // bamboo fence
      for (var x = X0; x < X1; x += 30) { var hh = FENCE_BASE - FENCE_TOP + (R() - 0.5) * 14; b.add([[x, FENCE_BASE + 4], [x, FENCE_BASE - hh + 6], [x + 14, FENCE_BASE - hh - 2], [x + 28, FENCE_BASE - hh + 6], [x + 28, FENCE_BASE + 4]], { fill: C.fence, g: 'fence', wob: 1.5 }); }
      for (var y = 0; y < 3; y++) { var ny = FENCE_BASE - 30 - y * 38; for (var x2 = X0; x2 < X1; x2 += 30) b.line([[x2 + 4, ny + (R() - 0.5) * 6], [x2 + 24, ny + (R() - 0.5) * 6]], { stroke: C.fenceNode, lw: 0.9, g: 'fnode', wob: 1 }); }
      [FENCE_BASE - 34, FENCE_BASE - 96].forEach(function (ry) { b.rect(X0, ry - 9, X1 - X0, 18, { fill: C.rail, g: 'rail', wob: 3 }); });
      for (var k = X0; k < X1; k += 240) [FENCE_BASE - 34, FENCE_BASE - 96].forEach(function (ry) { b.line([[k - 9, ry - 13], [k + 9, ry + 13]], { stroke: C.rope, lw: 1.3, g: 'rope', wob: 1 }).line([[k + 9, ry - 13], [k - 9, ry + 13]], { stroke: C.rope, lw: 1.3, g: 'rope', wob: 1 }); });
      // sandy ground and a grass hem along the fence
      b.rect(X0, FENCE_BASE + 10, X1 - X0, 5000, { fill: C.sand, stroke: false, wob: 0 });
      var gp = [[X0, FENCE_BASE + 46]];
      for (var gx = X0; gx <= X1; gx += 60) gp.push([gx, FENCE_BASE + 30 + (R() - 0.5) * 16]);
      gp.push([X1, FENCE_BASE + 46], [X1, FENCE_BASE - 8], [X0, FENCE_BASE - 8]);
      b.add(gp, { fill: C.grass, mode: 'merge', wob: 4 });
      for (var tf = X0; tf < X1; tf += 90 + R() * 120) { var ty = FENCE_BASE + 70 + R() * 900; if (ty > 1240 && ty < 1460) continue; b.line([[tf - 12, ty], [tf - 6, ty - 18], [tf, ty - 2], [tf + 7, ty - 22], [tf + 13, ty]], { stroke: '#9ccc80', lw: 1, g: 'tufts', wob: 1 }); }
      // raked gravel waves
      [1190, 1500, 1580, 1660, 1900, 1980].forEach(function (ry) {
        var pts = []; for (var rx = X0; rx <= X1; rx += 70) pts.push([rx, ry + 9 * Math.sin(rx * 0.012 + ry)]);
        b.line(pts, { stroke: C.rake, lw: 1.6, g: 'rake', wob: 2 });
      });
      // stepping stones along the garden
      for (var s = BOUNDS.garden[0] + 60, i = 0; s < BOUNDS.garden[1]; s += 230 + R() * 60, i++) {
        var sy = 1330 + (i % 2) * 60 + R() * 20, sw = 110 + R() * 40;
        b.ell(s, sy + 8, sw, 34, { fill: C.stoneDark, g: 'stoneSh', stroke: false, irr: 0.15 });
        b.ell(s, sy, sw, 32, { fill: C.stone, g: 'stone' + i, irr: 0.15 });
        b.line([[s - sw * 0.5, sy - 10], [s - sw * 0.1, sy - 16]], { stroke: '#ffffff', lw: 1.4, g: 'shine', wob: 1 });
      }
      // zen rocks with raked rings
      // (the zen rocks are drawn as movable things now, see PROPS)
      // bushes against the fence
      [-1500, -1050, -150, 880, 1550, 3300].forEach(function (x) { b.canopy(x, FENCE_BASE + 10, 95 + R() * 30, [F.bush[0], F.bush[1], F.bush[1]], { dots: sea === 'spring' }); });
      // a small koi pond on the left
      var px = -1150, py = 1580;
      for (var p = 0; p < 16; p++) { var a = p / 16 * Math.PI * 2; b.ell(px + Math.cos(a) * 300, py + Math.sin(a) * 92, 44, 26, { fill: C.stone, g: 'rim', irr: 0.2 }); }
      b.ell(px, py, 290, 82, { fill: C.pond, irr: 0.05 });
      [[-80, -20, 30], [120, 24, 24], [-200, 30, 20]].forEach(function (l) { b.add([[px + l[0], py + l[1]], [px + l[0] + l[2], py + l[1] - l[2] * 0.25], [px + l[0] + l[2] * 0.9, py + l[1] + l[2] * 0.3], [px + l[0], py + l[1] + l[2] * 0.42], [px + l[0] - l[2], py + l[1] + l[2] * 0.2], [px + l[0] - l[2] * 0.8, py + l[1] - l[2] * 0.3]], { fill: '#a6d58f', g: 'lily', wob: 1 }); });
      // stone lanterns
      lanternAt(b, 120); lanternAt(b, 1980);
      // a wooden sign
      var sx2 = -620;
      b.rect(sx2 - 8, FENCE_BASE - 40, 16, 170, { fill: C.woodDark });
      b.rect(sx2 - 165, FENCE_BASE - 122, 330, 94, { fill: C.wood, wob: 4 });
      GROUND_TEXT = [{ text: "pusheen's garden", x: sx2, y: FENCE_BASE - 75, size: 32 }];
      // plants and the house, if she has them
      if (owned.house) buildHouse(b, HOUSE.x, HOUSE.base);
      return { d: 1, groups: b.groups };
    }
    var GROUND_TEXT = [];
    var LANTERNS = [120, 1980];
    function lanternAt(b, x) {
      var y = FENCE_BASE + 60;
      b.rect(x - 70, y - 26, 140, 26, { fill: C.lantern });
      b.rect(x - 18, y - 150, 36, 124, { fill: C.lantern });
      b.rect(x - 60, y - 180, 120, 30, { fill: C.lantern });
      b.rect(x - 48, y - 270, 96, 90, { fill: C.lantern });
      b.rect(x - 22, y - 252, 44, 52, { fill: '#fff1c4' });
      b.add([[x - 92, y - 270], [x - 70, y - 300], [x, y - 330], [x + 70, y - 300], [x + 92, y - 270]], { fill: C.lantern });
      b.ell(x, y - 340, 16, 16, { fill: C.lantern });
      b.ell(x - 40, y - 290, 28, 10, { fill: C.moss, stroke: false, irr: 0.3 });
    }
    function buildHouse(b, x, base) {
      var w = HOUSE.w, wallTop = base - 430;
      b.rect(x - 30, base - 46, w + 60, 46, { fill: C.wood });
      for (var s = 0; s < 6; s++) b.rect(x + s * (w / 5) - 10, base - 6, 20, 46, { fill: C.woodDark, g: 'stilt' });
      b.rect(x + 20, wallTop, w - 40, base - 46 - wallTop, { fill: C.wall });
      [x + 20, x + w / 2 - 10, x + w - 40].forEach(function (bx) { b.rect(bx, wallTop, 20, base - 46 - wallTop, { fill: C.wood, g: 'beam' }); });
      b.rect(x + 20, wallTop + 60, w - 40, 16, { fill: C.wood });
      // sliding shoji door
      var dx = x + 300;
      b.rect(dx, base - 380, 180, 334, { fill: C.shoji });
      for (var i = 1; i < 3; i++) b.line([[dx + i * 60, base - 380], [dx + i * 60, base - 46]], { stroke: C.woodDark, lw: 0.9, g: 'shoji', wob: 1 });
      for (var j = 1; j < 5; j++) b.line([[dx, base - 380 + j * 67], [dx + 180, base - 380 + j * 67]], { stroke: C.woodDark, lw: 0.9, g: 'shoji', wob: 1 });
      // round window
      var wx = x + w - 200, wy = base - 250;
      b.ell(wx, wy, 92, 92, { fill: C.wood }); b.ell(wx, wy, 74, 74, { fill: C.shoji });
      b.line([[wx - 74, wy], [wx + 74, wy]], { stroke: C.woodDark, lw: 0.9, wob: 1 }).line([[wx, wy - 74], [wx, wy + 74]], { stroke: C.woodDark, lw: 0.9, wob: 1 });
      // big curved roof with tile lines
      var rl = x - 110, rr = x + w + 110, ry = wallTop + 20;
      b.add([[rl - 50, ry - 70], [rl + 30, ry - 6], [x + w / 2, ry - 24], [rr - 30, ry - 6], [rr + 50, ry - 70], [rr - 10, ry - 90], [x + w - 150, ry - 250], [x + w - 230, ry - 330], [x + 230, ry - 330], [x + 150, ry - 250], [rl + 10, ry - 90]], { fill: C.roof, wob: 4 });
      for (var r = 1; r < 5; r++) { var yy = ry - 30 - r * 58, inset = r * 42; b.line([[rl + 20 + inset, yy + 8], [x + w / 2, yy - 6], [rr - 20 - inset, yy + 8]], { stroke: C.roofDark, lw: 1.1, g: 'tiles', wob: 2 }); }
      b.rect(x + 200, ry - 352, w - 400, 34, { fill: C.roofDark });
      b.ell(x + 200, ry - 335, 26, 26, { fill: C.roofDark }); b.ell(x + w - 200, ry - 335, 26, 26, { fill: C.roofDark });
      // step stone
      b.ell(dx + 90, base + 30, 120, 26, { fill: C.stone, irr: 0.1 });
      HOUSE_GLOW = [{ x: dx + 90, y: base - 213, rx: 90, ry: 167, door: true }, { x: wx, y: wy, rx: 74, ry: 74 }];
    }
    var HOUSE_GLOW = [];

    // ---------- things she can own ----------
    function pot(b, x, y, w, h, col) { b.add([[x - w / 2, y - h], [x + w / 2, y - h], [x + w * 0.38, y], [x - w * 0.38, y]], { fill: col || C.pot, wob: 2 }); b.rect(x - w / 2 - 8, y - h - 16, w + 16, 20, { fill: col || C.pot, wob: 2 }); }
    var ITEMS = {
      house: { draw: function (b, x, y) { buildHouse(b, x, y); } },
      fern: { draw: function (b, x, y) { pot(b, x, y, 90, 80); for (var i = 0; i < 9; i++) { var a = -Math.PI / 2 + (i - 4) * 0.33, L = 110 + (i % 3) * 20; b.add([[x, y - 96], [x + Math.cos(a - 0.15) * L * 0.6, y - 96 + Math.sin(a - 0.15) * L * 0.6], [x + Math.cos(a) * L, y - 96 + Math.sin(a) * L], [x + Math.cos(a + 0.15) * L * 0.6, y - 96 + Math.sin(a + 0.15) * L * 0.6]], { fill: '#9fd28a', g: 'fern', wob: 2 }); } } },
      hydrangea: { draw: function (b, x, y) { pot(b, x, y, 110, 86, C.potBlue); b.canopy(x, y - 150, 80, ['#a9c3f0', '#c9b8ef', '#e0d4f7']); for (var i = 0; i < 9; i++) b.ell(x - 50 + (i % 3) * 50, y - 190 + Math.floor(i / 3) * 34, 9, 9, { fill: '#d7c7f5', stroke: false, g: 'hyd' }); b.add([[x - 70, y - 100], [x - 100, y - 130], [x - 40, y - 120]], { fill: '#a3d48c' }); } },
      sunflower: { draw: function (b, x, y) { pot(b, x, y, 96, 84); [[-26, 260], [22, 330]].forEach(function (f) { var fx = x + f[0], fy = y - f[1]; b.line([[x + f[0] * 0.3, y - 96], [fx, fy]], { stroke: '#7fb36a', lw: 1.8 }); b.add([[fx, fy + 70], [fx + 46, fy + 40], [fx + 4, fy + 52]], { fill: '#a3d48c' }); for (var p = 0; p < 12; p++) { var a = p / 12 * Math.PI * 2; b.ell(fx + Math.cos(a) * 34, fy + Math.sin(a) * 34, 18, 10, { fill: '#ffd85e', g: 'petal' + f[0] }); } b.ell(fx, fy, 26, 26, { fill: '#a77a57' }); }); } },
      bonsai: { draw: function (b, x, y) { b.rect(x - 90, y - 40, 180, 40, { fill: C.woodDark }); b.rect(x - 70, y - 70, 140, 34, { fill: '#8fa1c9' }); b.add([[x - 12, y - 70], [x - 30, y - 140], [x + 10, y - 190], [x + 40, y - 210], [x + 16, y - 160], [x + 12, y - 70]], { fill: C.trunk }); b.canopy(x + 40, y - 230, 62, ['#9cc985', '#b5dd9c', '#9cc985']); b.canopy(x - 40, y - 170, 48, ['#9cc985', '#b5dd9c', '#9cc985']); } },
      sapling: { draw: function (b, x, y) { b.ell(x, y, 90, 22, { fill: '#c9a98e' }); b.add([[x - 12, y], [x - 8, y - 200], [x - 50, y - 270], [x - 2, y - 230], [x + 8, y - 300], [x + 14, y - 200], [x + 14, y]], { fill: C.trunk }); b.canopy(x, y - 320, 120, ['#f9c9d8', '#fde3eb', '#f2a9c1'], { dots: true }); } },
      // inside the house
      rug: { inside: true, draw: function (b) { b.ell(660, 1340, 560, 120, { fill: '#f7cdd8', irr: 0.03 }); b.ell(660, 1340, 470, 92, { fill: null, stroke: '#eaa9bd', lw: 1.4, irr: 0.03 }); b.ell(660, 1340, 380, 70, { fill: null, stroke: '#eaa9bd', lw: 1.4, irr: 0.03 }); } },
      bookshelf: { inside: true, draw: function (b) { var x = -220, w = 440, top = 280; b.rect(x, top, w, FLOOR - top + 10, { fill: C.wood }); b.rect(x + 22, top + 22, w - 44, FLOOR - top - 40, { fill: '#c49470' }); for (var s = 1; s < 4; s++) b.rect(x + 22, top + s * 210 - 10, w - 44, 18, { fill: C.wood, g: 'shelf' }); drawBooks(b, x, top, w); } },
      lamp: { inside: true, draw: function (b) { var x = 340, y = FLOOR + 30; b.rect(x - 60, y - 20, 120, 20, { fill: C.woodDark }); b.rect(x - 50, y - 300, 100, 280, { fill: '#fff4d2' }); [x - 50, x + 40].forEach(function (lx) { b.rect(lx, y - 310, 12, 300, { fill: C.woodDark, g: 'lampf' }); }); b.line([[x - 50, y - 160], [x + 50, y - 160]], { stroke: C.woodDark, lw: 1.2 }); b.rect(x - 60, y - 320, 120, 18, { fill: C.woodDark }); LAMP_ON = { x: x, y: y - 160 }; } },
      scroll: { inside: true, draw: function (b) { var x = -480, w = 150; b.rect(x - 10, 230, w + 20, 18, { fill: C.woodDark }); b.rect(x, 246, w, 520, { fill: '#fffaf0' }); b.rect(x - 10, 762, w + 20, 18, { fill: C.woodDark }); b.add([[x + 20, 600], [x + 75, 430], [x + 130, 600]], { fill: '#c9d3ee', wob: 3 }); b.add([[x + 58, 482], [x + 75, 430], [x + 92, 482], [x + 80, 470], [x + 70, 486]], { fill: '#ffffff', wob: 1 }); b.ell(x + 110, 330, 18, 18, { fill: '#f6a4a4' }); } },
      table: { inside: true, draw: function (b) { var x = 1200, y = 1440; [-130, 130].forEach(function (o) { b.rect(x + o - 12, y, 24, 80, { fill: C.woodDark, g: 'tleg' }); }); b.ell(x, y, 220, 50, { fill: C.wood }); b.ell(x, y - 6, 196, 38, { fill: null, stroke: C.woodDark, lw: 0.9 }); } },
      cushion: { inside: true, draw: function (b) { var x = 930, y = 1560; b.add([[x - 130, y], [x - 100, y - 48], [x + 100, y - 48], [x + 130, y], [x + 100, y + 30], [x - 100, y + 30]], { fill: '#d9b4e8', wob: 3 }); b.ell(x, y - 8, 12, 8, { fill: '#b98fd0' }); } },
      teaset: { inside: true, needs: 'table', draw: function (b) { var x = 1200, y = 1420; b.ell(x - 40, y - 46, 50, 40, { fill: '#a9cbb7' }); b.add([[x - 4, y - 60], [x + 30, y - 76], [x + 26, y - 64], [x + 4, y - 44]], { fill: '#a9cbb7' }); b.ell(x - 40, y - 88, 14, 8, { fill: '#a9cbb7' }); [60, 120].forEach(function (o) { b.rect(x + o - 20, y - 40, 40, 34, { fill: '#fffaf0', g: 'cup' }); }); TEA = { x: x - 40, y: y - 96 }; } },
      futon: { inside: true, draw: function (b) { var x = 60, y = 1520; b.rect(x - 230, y - 60, 460, 110, { fill: '#ffffff' }); b.rect(x - 230, y - 60, 300, 110, { fill: '#f6c9d4', wob: 3 }); b.ell(x + 150, y - 10, 70, 36, { fill: '#fffaf0' }); for (var i = 0; i < 4; i++) b.ell(x - 200 + i * 70, y - 4, 8, 8, { fill: '#fbe3ea', stroke: false, g: 'fdots' }); } },
      record: { inside: true, draw: function (b) { var x = 1560, y = FLOOR + 20; b.rect(x - 140, y - 240, 280, 240, { fill: C.wood }); b.rect(x - 120, y - 200, 110, 170, { fill: '#c49470' }); b.rect(x + 10, y - 200, 110, 170, { fill: '#c49470' }); b.rect(x - 130, y - 300, 260, 60, { fill: '#f0dcc4' }); b.ell(x - 10, y - 278, 90, 18, { fill: '#3e3a44' }); b.ell(x - 10, y - 280, 22, 6, { fill: '#f6a4a4' }); b.line([[x + 110, y - 290], [x + 40, y - 270]], { stroke: INK, lw: 1.4 }); RECORD = { x: x - 10, y: y - 280 }; } },
      sillplant: { inside: true, draw: function (b) { var x = 1180, y = 712; pot(b, x, y, 60, 50); b.canopy(x, y - 80, 42, ['#9fd28a', '#bfe3a8', '#9fd28a']); } },
      books: { inside: true, needs: 'bookshelf', draw: function () {} },
      // food: drawn around (0,0), roughly 200 wide
      onigiri: { food: true, draw: function (b, x, y) { b.add([[x, y - 90], [x + 85, y + 50], [x - 85, y + 50]], { fill: '#ffffff', wob: 5 }); b.rect(x - 40, y + 2, 80, 50, { fill: '#3f5a4a' }); b.ell(x - 30, y - 30, 6, 6, { fill: '#e9e4d8', stroke: false }); b.ell(x + 20, y - 52, 5, 5, { fill: '#e9e4d8', stroke: false }); } },
      dango: { food: true, draw: function (b, x, y) { b.line([[x - 110, y + 80], [x + 90, y - 80]], { stroke: '#c49a74', lw: 3 }); [['#f8c4d3', -55, 44], ['#fffaf0', 0, 0], ['#b9dc9c', 55, -44]].forEach(function (d) { b.ell(x + d[1], y + d[2], 44, 44, { fill: d[0] }); }); } },
      taiyaki: { food: true, draw: function (b, x, y) { b.add([[x - 90, y], [x - 40, y - 50], [x + 40, y - 45], [x + 70, y - 20], [x + 110, y - 55], [x + 100, y], [x + 110, y + 55], [x + 70, y + 20], [x + 40, y + 45], [x - 40, y + 50]], { fill: '#e2a65f', wob: 4 }); b.ell(x - 55, y - 10, 9, 9, { fill: '#5b4944' }); for (var i = 0; i < 3; i++) b.line([[x - 10 + i * 30, y - 30], [x + 5 + i * 30, y], [x - 10 + i * 30, y + 30]], { stroke: '#b97a3c', lw: 1.2, g: 'scale' }); } },
      daifuku: { food: true, draw: function (b, x, y) { b.ell(x, y + 10, 90, 70, { fill: '#fffaf6' }); b.add([[x - 30, y - 45], [x, y - 95], [x + 30, y - 45], [x, y - 30]], { fill: '#f27a7a', wob: 3 }); b.add([[x - 14, y - 92], [x, y - 104], [x + 14, y - 92]], { fill: '#8fcf7e', wob: 2 }); b.ell(x - 40, y + 20, 10, 6, { fill: '#f8c4d3', stroke: false }); b.ell(x + 40, y + 20, 10, 6, { fill: '#f8c4d3', stroke: false }); } },
      melonpan: { food: true, draw: function (b, x, y) {
        b.ell(x, y, 100, 76, { fill: '#f6d27a' });
        for (var i = -2; i <= 2; i++) {                 // the criss-cross, kept inside the bun
          var yy = i * 26, hx = 100 * Math.sqrt(Math.max(0, 1 - Math.pow(yy / 76, 2))) * 0.82;
          b.line([[x - hx, y + yy], [x + hx, y + yy]], { stroke: '#d9a94a', lw: 1.2, g: 'mp' });
          var xx = i * 34, hy = 76 * Math.sqrt(Math.max(0, 1 - Math.pow(xx / 100, 2))) * 0.82;
          b.line([[x + xx, y - hy], [x + xx, y + hy]], { stroke: '#d9a94a', lw: 1.2, g: 'mp' });
        } } },
      matcha: { food: true, draw: function (b, x, y) { b.add([[x - 80, y - 40], [x + 80, y - 40], [x + 60, y + 60], [x - 60, y + 60]], { fill: '#e8dcc8', wob: 3 }); b.ell(x, y - 40, 80, 18, { fill: '#9cc985' }); b.add([[x + 75, y - 20], [x + 110, y - 10], [x + 100, y + 30], [x + 66, y + 30]], { fill: null, stroke: '#5b4944', closed: false, wob: 2 }); } },
      ramen: { food: true, draw: function (b, x, y) { b.add([[x - 110, y - 20], [x + 110, y - 20], [x + 80, y + 60], [x - 80, y + 60]], { fill: '#f3a3a3', wob: 3 }); b.ell(x, y - 20, 110, 24, { fill: '#f6d9a8' }); b.ell(x - 35, y - 24, 26, 12, { fill: '#ffffff' }); b.ell(x - 35, y - 24, 11, 6, { fill: '#f6c445', stroke: false }); b.rect(x + 20, y - 34, 50, 16, { fill: '#3f5a4a' }); b.line([[x + 60, y - 120], [x - 10, y - 20]], { stroke: '#c49a74', lw: 2.4 }).line([[x + 85, y - 115], [x + 10, y - 22]], { stroke: '#c49a74', lw: 2.4 }); } },
      cake: { food: true, draw: function (b, x, y) { b.add([[x - 100, y + 50], [x + 100, y + 50], [x + 100, y - 20], [x - 60, y - 60], [x - 100, y - 20]], { fill: '#fff7ea', wob: 3 }); b.line([[x - 100, y + 12], [x + 100, y + 12]], { stroke: '#f8c4d3', lw: 3 }); b.add([[x - 30, y - 50], [x - 10, y - 95], [x + 10, y - 50]], { fill: '#f27a7a', wob: 2 }); } },
      tamagoyaki: { food: true, draw: function (b, x, y) { b.rect(x - 100, y - 40, 200, 80, { fill: '#ffe08a', wob: 4 }); for (var i = 1; i < 4; i++) b.line([[x - 100 + i * 50, y - 40], [x - 100 + i * 50, y + 40]], { stroke: '#e3b94e', lw: 1.2, g: 'tam' }); } },
      natto: { food: true, draw: function (b, x, y) { b.rect(x - 90, y - 40, 180, 90, { fill: '#ffffff', wob: 3 }); for (var i = 0; i < 9; i++) b.ell(x - 60 + (i % 3) * 60 + (i * 7 % 13), y - 10 + Math.floor(i / 3) * 22, 18, 13, { fill: '#c99a56', g: 'bean' }); b.line([[x - 70, y - 30], [x - 30, y - 70], [x + 10, y - 40], [x + 50, y - 80]], { stroke: '#d9c9a0', lw: 1 }); } }
    };
    Object.assign(ITEMS, {
      tea: { food: true, draw: function (b, x, y) { b.add([[x - 70, y - 50], [x + 70, y - 50], [x + 56, y + 60], [x - 56, y + 60]], { fill: '#fffaf0', wob: 3 }); b.ell(x, y - 50, 70, 16, { fill: '#e8b96a' }); b.add([[x + 66, y - 30], [x + 104, y - 24], [x + 100, y + 20], [x + 60, y + 26]], { fill: null, stroke: '#5b4944', lw: 1.4 }); b.ell(x - 22, y - 52, 16, 7, { fill: '#f3d27d', g: 'ging' }); [[-30, 0], [10, 20]].forEach(function (q) { b.line([[x + q[0], y - 70], [x + q[0] + 14, y - 110 - q[1]], [x + q[0] - 4, y - 150 - q[1]]], { stroke: '#c9c2b8', lw: 1.4, g: 'steam' }); }); } },
      telescope: { draw: function (b, x, y) { [[-70, 0], [70, 0], [0, 30]].forEach(function (q) { b.line([[x, y - 170], [x + q[0], y + q[1]]], { stroke: C.woodDark, lw: 3, g: 'tri' }); }); b.add([[x - 120, y - 150], [x + 110, y - 260], [x + 126, y - 226], [x - 104, y - 118]], { fill: '#a0b1dd', wob: 2 }); b.rect(x + 96, y - 270, 40, 60, { fill: '#8a9acb', wob: 1 }); b.ell(x, y - 180, 18, 18, { fill: C.woodDark }); } },
      easel: { draw: function (b, x, y) { b.line([[x - 80, y], [x, y - 330]], { stroke: C.woodDark, lw: 3, g: 'el' }); b.line([[x + 80, y], [x, y - 330]], { stroke: C.woodDark, lw: 3, g: 'el' }); b.rect(x - 100, y - 300, 200, 160, { fill: '#fffaf0', wob: 2 }); b.add([[x - 80, y - 160], [x - 20, y - 260], [x + 30, y - 200], [x + 50, y - 230], [x + 84, y - 160]], { fill: '#aebbe1', wob: 2 }); b.add([[x - 34, y - 236], [x - 20, y - 260], [x - 6, y - 236]], { fill: '#ffffff', wob: 1 }); b.rect(x - 110, y - 140, 220, 14, { fill: C.wood }); } },
      goldfish: { draw: function (b, x, y) { b.ell(x, y - 70, 74, 70, { fill: '#d6eefa', irr: 0.04 }); b.ell(x, y - 132, 50, 12, { fill: '#c4e5f5' }); b.add([[x - 24, y - 70], [x + 8, y - 88], [x + 24, y - 70], [x + 8, y - 54]], { fill: '#f6a046', wob: 2 }); b.add([[x + 24, y - 70], [x + 42, y - 84], [x + 40, y - 56]], { fill: '#f6a046', wob: 1 }); b.ell(x, y - 6, 60, 10, { fill: '#c0b8ae' }); } },
      kite: { draw: function () {} }
    });
    var LAMP_ON = null, TEA = null, RECORD = null;
    var BOOK_COLS = ['#f6a4a4', '#a9c3f0', '#f9d77e', '#b5dd9c', '#d9b4e8', '#f7c19c', '#9fd3d0'];
    function drawBooks(b, x, top, w) {
      var n = Math.min(6, owned.books || 0), R = b.R;
      for (var i = 0; i < n; i++) {
        var row = Math.floor(i / 2), half = i % 2, sx = x + 30 + half * (w - 60) / 2, sy = top + 22 + (row + 1) * 210 - 12, bx = sx;
        while (bx < sx + (w - 70) / 2 - 20) {
          var bw = 20 + R() * 16, bh = 120 + R() * 50, lean = R() < 0.15;
          if (lean) b.add([[bx, sy], [bx + 30, sy - bh * 0.95], [bx + 30 + bw, sy - bh * 0.92], [bx + bw, sy]], { fill: BOOK_COLS[Math.floor(R() * BOOK_COLS.length)], wob: 1 });
          else b.rect(bx, sy - bh, bw, bh, { fill: BOOK_COLS[Math.floor(R() * BOOK_COLS.length)], wob: 1 });
          bx += bw + (lean ? 26 : 2);
        }
      }
    }
    function buildRoom() {
      var b = new Builder(71), R = b.R, X0 = BOUNDS.house[0] - 1800, X1 = BOUNDS.house[1] + 1800;
      b.rect(X0, -3000, X1 - X0, FLOOR + 3000, { fill: C.roomWall, stroke: false, wob: 0 });
      b.rect(X0, FLOOR - 130, X1 - X0, 130, { fill: C.wains, wob: 2 });
      b.rect(X0, -160, X1 - X0, 60, { fill: C.woodDark, wob: 2 });
      [BOUNDS.house[0] - 40, BOUNDS.house[1] + 20].forEach(function (px) { b.rect(px, -3000, 60, FLOOR + 3010, { fill: C.wood }); });
      // the window (sky is painted in each frame)
      WINDOW = { x: 860, y: 250, w: 400, h: 440 };
      b.rect(WINDOW.x - 26, WINDOW.y - 26, WINDOW.w + 52, WINDOW.h + 52, { fill: C.wood });
      b.rect(X0, FLOOR, X1 - X0, 5000, { fill: C.tatami, stroke: false, wob: 0 });
      for (var tx = X0; tx < X1; tx += 520) b.line([[tx, FLOOR], [tx - 120, FLOOR + 3000]], { stroke: C.tatamiEdge, lw: 1.6, g: 'tat' });
      [FLOOR + 260, FLOOR + 700].forEach(function (ty) { b.line([[X0, ty], [X1, ty]], { stroke: C.tatamiEdge, lw: 1.6, g: 'tat', wob: 2 }); });
      b.line([[X0, FLOOR], [X1, FLOOR]], { stroke: INK, lw: 1.2, wob: 1 });
      LAMP_ON = null; TEA = null; RECORD = null;
      ['rug', 'scroll', 'bookshelf', 'lamp', 'record', 'futon', 'table', 'teaset', 'cushion', 'sillplant'].forEach(function (id) { if (owned[id]) ITEMS[id].draw(b); });
      if (owned.goldfish) { b.rect(1740, FLOOR - 120, 150, 140, { fill: C.woodDark }); ITEMS.goldfish.draw(b, 1815, FLOOR - 118); }
      if (owned.sillplant) b.rect(WINDOW.x - 30, WINDOW.y + WINDOW.h + 10, WINDOW.w + 60, 24, { fill: C.wood });
      return { d: 1, groups: b.groups };
    }
    var WINDOW = { x: 860, y: 250, w: 400, h: 440 };
    // window frame lattice drawn over the painted sky
    var latticeB = null;
    function lattice() {
      if (latticeB) return latticeB;
      var b = new Builder(91), W = WINDOW;
      b.line([[W.x + W.w / 2, W.y], [W.x + W.w / 2, W.y + W.h]], { stroke: C.woodDark, lw: 2.2, wob: 1 }).line([[W.x, W.y + W.h / 2], [W.x + W.w, W.y + W.h / 2]], { stroke: C.woodDark, lw: 2.2, wob: 1 });
      b.rect(W.x + W.w * 0.58, W.y, W.w * 0.42, W.h, { fill: 'rgba(255,250,240,0.92)', stroke: C.woodDark, wob: 1 });
      for (var i = 1; i < 3; i++) b.line([[W.x + W.w * 0.58 + i * W.w * 0.14, W.y], [W.x + W.w * 0.58 + i * W.w * 0.14, W.y + W.h]], { stroke: C.woodDark, lw: 0.8, g: 'lat', wob: 1 });
      for (var j = 1; j < 5; j++) b.line([[W.x + W.w * 0.58, W.y + j * W.h / 5], [W.x + W.w, W.y + j * W.h / 5]], { stroke: C.woodDark, lw: 0.8, g: 'lat', wob: 1 });
      latticeB = b.groups; return latticeB;
    }

    // ---------- sky (painted behind everything at the end) ----------
    var SKY = [
      [0, '#1c2050', '#3a3e7a'], [4.8, '#262a63', '#4b4c8c'], [5.9, '#7072b6', '#f6c2bd'], [7.2, '#a9d9f2', '#fdf3df'], [12, '#9fd3f3', '#e8f6fc'],
      [16.4, '#a7d2ef', '#fde9c8'], [18.1, '#8b8fd2', '#ffb79f'], [19.2, '#4c4f96', '#b18cc1'], [20.4, '#1c2050', '#3a3e7a'], [24, '#1c2050', '#3a3e7a']
    ];
    var WASH = [[0, 38, 40, 98, 0.5], [4.8, 38, 40, 98, 0.5], [6, 255, 160, 150, 0.14], [7.4, 255, 255, 255, 0], [16.3, 255, 255, 255, 0], [17.6, 255, 170, 110, 0.1],
                [18.4, 255, 120, 120, 0.17], [19.3, 90, 70, 150, 0.32], [20.4, 38, 40, 98, 0.5], [24, 38, 40, 98, 0.5]];
    function key(arr, h) { var i = 0; while (i < arr.length - 2 && h >= arr[i + 1][0]) i++; return [arr[i], arr[i + 1], sm((h - arr[i][0]) / (arr[i + 1][0] - arr[i][0]))]; }
    function skyCols(h) { var k = key(SKY, h); return [mix(hexA(k[0][1]), hexA(k[1][1]), k[2]), mix(hexA(k[0][2]), hexA(k[1][2]), k[2])]; }
    function wash(h) { var k = key(WASH, h), a = k[0], b = k[1], u = k[2]; return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u]; }
    function nightness(h) { return h < 5 || h > 20.4 ? 1 : h < 6.5 ? 1 - sm((h - 5) / 1.5) : h > 18.6 ? sm((h - 18.6) / 1.8) : 0; }
    var stars = []; (function () { var R = rng(5); for (var i = 0; i < 80; i++) stars.push({ x: R(), y: R() * 0.8, s: 1 + R() * 2.2, ph: R() * 6, big: R() < 0.14 }); })();
    var clouds = []; (function () { var R = rng(9); for (var i = 0; i < 6; i++) { var b = new Builder(100 + i); b.add(cloudPts(0, 0, 220 + b.R() * 160, 70 + b.R() * 40, b.R), { fill: '#ffffff', wob: 3 }); clouds.push({ g: b.groups, x: R(), y: 0.08 + R() * 0.32, v: 0.004 + R() * 0.006, s: 0.6 + R() * 0.5 }); } })();
    var shoot = null;
    function sunMoon(h, w, horizon) {
      var out = {};
      var arc = function (u) { return { x: w * (0.08 + 0.84 * u), y: horizon - (horizon - Math.max(60, horizon * 0.16)) * Math.sin(Math.PI * u), u: u }; };
      if (h > 5.8 && h < 19.2) out.sun = arc((h - 5.8) / 13.4);
      var mh = h < 12 ? h + 24 : h; if (mh > 19.2 && mh < 30.4) out.moon = arc((mh - 19.2) / 11.2);
      return out;
    }
    // painted with 'destination-over', so the steps run back to front: what's listed last ends up at the very back
    function drawSky(c, V, horizon, h, t) {
      var steps = [], w = V.w, H = V.h, cols = skyCols(h), n = nightness(h), gk = GREY[wxKind()] || 0;
      if (gk) cols = cols.map(function (c0) { var l = (c0[0] + c0[1] + c0[2]) / 3; return mix(c0, [l * 0.95, l * 0.97, l * 1.02], gk); });
      steps.push(function () {
        var g = c.createLinearGradient(0, 0, 0, Math.max(horizon, 100));
        g.addColorStop(0, rgb(cols[0])); g.addColorStop(1, rgb(cols[1]));
        c.fillStyle = g; c.fillRect(-20, -20, w + 40, H + 40);
      });
      if (n > 0.05) steps.push(function () {
        stars.forEach(function (s) {
          var y = s.y * horizon; if (y > horizon - 20) return;
          c.globalAlpha = n * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.ph)));
          c.fillStyle = '#fff7d6';
          if (s.big) { var r = s.s * 3; c.beginPath(); c.moveTo(s.x * w, y - r); c.quadraticCurveTo(s.x * w, y, s.x * w + r, y); c.quadraticCurveTo(s.x * w, y, s.x * w, y + r); c.quadraticCurveTo(s.x * w, y, s.x * w - r, y); c.quadraticCurveTo(s.x * w, y, s.x * w, y - r); c.fill(); }
          else { c.beginPath(); c.arc(s.x * w, y, s.s * 0.8, 0, Math.PI * 2); c.fill(); }
        });
        c.globalAlpha = 1;
        if (!V.reduce && !shoot && Math.random() < 0.0012 * n) shoot = { x: Math.random() * w * 0.7, y: Math.random() * horizon * 0.3, t0: t };
        if (shoot) {
          var u = (t - shoot.t0) / 0.8;
          if (u > 1) shoot = null;
          else { c.strokeStyle = 'rgba(255,247,214,' + (1 - u) + ')'; c.lineWidth = 2.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(shoot.x + u * 240 - 60, shoot.y + u * 100 - 25); c.lineTo(shoot.x + u * 240, shoot.y + u * 100); c.stroke(); }
        }
      });
      var smn = sunMoon(h, w, horizon);
      steps.push(function () {
      c.lineWidth = 2.4; c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round';
      if (smn.sun && gk < 0.4) {
        var s = smn.sun, warm = 1 - Math.sin(Math.PI * s.u);
        for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2 + t * 0.15; c.beginPath(); c.moveTo(s.x + Math.cos(a) * 36, s.y + Math.sin(a) * 36); c.lineTo(s.x + Math.cos(a) * 48, s.y + Math.sin(a) * 48); c.stroke(); }
        c.fillStyle = rgb(mix([255, 226, 138], [255, 176, 120], warm));
        c.beginPath(); c.arc(s.x, s.y, 26, 0, Math.PI * 2); c.stroke(); c.fill();
      }
      if (smn.moon && EVENTS.indexOf('tsukimi') >= 0) { var mm = smn.moon; c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(mm.x, mm.y, 40, 0, Math.PI * 2); c.stroke(); c.fill(); c.fillStyle = 'rgba(230,214,160,0.7)'; c.beginPath(); c.arc(mm.x - 10, mm.y - 6, 9, 0, Math.PI * 2); c.arc(mm.x + 14, mm.y + 10, 6, 0, Math.PI * 2); c.fill(); }
      else if (smn.moon) {
        var m = smn.moon;
        c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(m.x, m.y, 22, 0.35 * Math.PI, 1.65 * Math.PI, false);
        c.quadraticCurveTo(m.x - 4, m.y, m.x + Math.cos(0.35 * Math.PI) * 22, m.y + Math.sin(0.35 * Math.PI) * 22); c.stroke(); c.fill();
      }
      });
      steps.push(function () {
      c.lineWidth = 2;
      clouds.forEach(function (cl) {
        var cs = cl.s * Math.min(1, Math.max(0.45, w / 1000));
        var x = ((cl.x * (w + 700) + (V.reduce ? 0 : t * cl.v * w)) % (w + 700)) - 350, y = cl.y * horizon;
        c.save(); c.translate(x, y); c.scale(cs, cs);
        c.globalAlpha = 0.95;
        // stroke first, then fill: under destination-over the outline must sit above the fill
        cl.g.forEach(function (gr) { c.strokeStyle = INK; c.lineWidth = 2 / cs; c.stroke(gr.path); c.fillStyle = n > 0.5 ? (gk > 0.3 ? '#8e8cb8' : '#a9a7da') : gk > 0.3 ? rgb(mix([255, 255, 255], [196, 200, 212], gk)) : '#ffffff'; c.fill(gr.path); });
        c.restore();
      });
      });
      for (var i = steps.length - 1; i >= 0; i--) steps[i]();
      return smn;
    }

    // ---------- moving bits ----------
    var falls = [];
    function drawFalls(c, V, t) {
      var wk2 = wxKind(), kind = wk2 === 'snow' ? 'snow' : (wk2 === 'rain' || wk2 === 'storm') && FOL[season()].fall === 'snow' ? null : FOL[season()].fall; if (!kind || V.reduce || V.place === 'house') { falls.length = 0; return; }
      var want = kind === 'snow' ? (wk2 === 'snow' ? 110 : 44) : EVENTS.indexOf('hanami') >= 0 ? 40 : 16;
      if (falls.length && falls[0].kind !== kind) falls.length = 0;
      if (falls.length > want) falls.length = want;
      while (falls.length < want) falls.push({ kind: kind, x: Math.random() * V.w, y: -20 - Math.random() * V.h, v: kind === 'snow' ? 26 + Math.random() * 30 : 34 + Math.random() * 26, ph: Math.random() * 6, r: kind === 'snow' ? 2.5 + Math.random() * 3 : 6 + Math.random() * 4, sp: Math.random() * 2 - 1 });
      c.lineWidth = 1.4; c.strokeStyle = INK;
      falls.forEach(function (p) {
        p.y += p.v / 60; p.x += Math.sin(t * 1.2 + p.ph) * 0.7 + 0.25;
        if (p.y > V.h + 20) { p.y = -20; p.x = Math.random() * V.w; }
        c.save(); c.translate(p.x, p.y); c.rotate(t * p.sp + p.ph);
        if (kind === 'snow') { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, p.r, 0, Math.PI * 2); c.fill(); }
        else {
          c.fillStyle = kind === 'petal' ? '#f9c9d8' : ['#f6a46f', '#f9c56f', '#ee8a63'][Math.floor(p.ph) % 3];
          c.beginPath(); c.moveTo(-p.r, 0); c.quadraticCurveTo(0, -p.r * 0.8, p.r, 0); c.quadraticCurveTo(0, p.r * 0.8, -p.r, 0); c.fill(); c.stroke();
        }
        c.restore();
      });
    }
    function drawKoi(c, t, s) {
      var px = -1150, py = 1580;
      [[0, '#ffa46e'], [2.4, '#ffffff'], [4.2, '#ffcf7a']].forEach(function (k, i) {
        var a = t * (0.35 + i * 0.07) + k[0], x = px + Math.cos(a) * 190, y = py + Math.sin(a) * 42, dir = a + Math.PI / 2;
        c.save(); c.translate(x, y); c.rotate(Math.atan2(Math.cos(a) * 42, -Math.sin(a) * 190));
        c.fillStyle = k[1]; c.strokeStyle = INK; c.lineWidth = 2.2 / s;
        c.beginPath(); c.ellipse(0, 0, 34, 13, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(-30, 0); c.lineTo(-52, -12 + 4 * Math.sin(t * 8 + i)); c.lineTo(-52, 12 + 4 * Math.sin(t * 8 + i)); c.closePath(); c.fill(); c.stroke();
        if (k[1] === '#ffffff') { c.fillStyle = '#ff9a6a'; c.beginPath(); c.ellipse(8, -2, 9, 6, 0, 0, Math.PI * 2); c.fill(); }
        c.restore();
      });
    }
    function drawBoat(c, t, s) {
      var x = -2600 + ((t * 9) % 7000), y = LAKE_TOP + 50;
      c.save(); c.translate(x, y + Math.sin(t * 1.4) * 2); c.fillStyle = '#ffffff'; c.strokeStyle = INK; c.lineWidth = 2.2 / s; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-34, 0); c.lineTo(34, 0); c.lineTo(24, 14); c.lineTo(-24, 14); c.closePath(); c.fillStyle = '#f6a4a4'; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(0, -2); c.lineTo(0, -60); c.lineTo(28, -12); c.closePath(); c.fillStyle = '#ffffff'; c.fill(); c.stroke();
      c.restore();
    }

    // ---------- one frame ----------
    var paper = (function () {
      var cv2 = document.createElement('canvas'); cv2.width = cv2.height = 160; var g = cv2.getContext('2d'), d = g.createImageData(160, 160), R = rng(3);
      for (var i = 0; i < d.data.length; i += 4) { var v = 200 + R() * 55; d.data[i] = v; d.data[i + 1] = v * 0.98; d.data[i + 2] = v * 0.94; d.data[i + 3] = 255; }
      g.putImageData(d, 0, 0); return cv2;
    })(), paperPat = null;
    function paint(c, groups, px, alpha) {
      groups.forEach(function (gr) {
        if (alpha != null) c.globalAlpha = alpha;
        var lw = px * gr.lw;
        if (gr.mode === 'merge') {
          if (gr.stroke) { c.strokeStyle = gr.stroke; c.lineWidth = lw * 2; c.stroke(gr.path); }
          if (gr.fill) { c.fillStyle = gr.fill; c.fill(gr.path); }
        } else {
          if (gr.fill) { c.fillStyle = gr.fill; c.fill(gr.path); }
          if (gr.stroke) { c.strokeStyle = gr.stroke; c.lineWidth = lw; c.stroke(gr.path); }
        }
      });
      c.globalAlpha = 1;
    }
    // where a layer of depth d sits on screen
    function layerXf(V, d) {
      var s = V.k * V.camS, sd = V.k * (1 + (V.camS - 1) * d);
      var fx = 660 - V.camX / s, cx = 660 + (fx - 660) * d;
      var glue = V.h * V.anchor + V.camY + (FENCE_TOP - 640) * s;
      return { s: sd, tx: V.w / 2 - cx * sd + V.shx, ty: glue - FENCE_TOP * sd + V.shy, glue: glue };
    }
    function setXf(c, V, X) { c.setTransform(V.dpr * X.s, 0, 0, V.dpr * X.s, V.dpr * X.tx, V.dpr * X.ty); }
    // ---------- living things drawn every frame: plants that grow and wilt, visitors, the mailbox, photos on her wall ----------
    var lastT = 0, PSTATE = {}, plantB = {}, VIS = null, MAIL = { has: false, flag: false }, WALL = [], FW = false, fw = [], fwNext = 0, waterFx = [];
    var WALL_SPOTS = [[1430, 300], [1610, 330], [1790, 300], [1430, 520], [1610, 540], [1790, 520], [470, 320], [640, 350]];
    // ---------- things standing on the garden floor. Each has a spot (yours to change in "Arrange the garden") and is drawn
    // in depth order with her and the visitors, so she can walk behind the bonsai and in front of the rocks ----------
    var HOME = {
      fern: [470, FENCE_BASE + 70], hydrangea: [1060, FENCE_BASE + 74], sunflower: [-80, FENCE_BASE + 70], bonsai: [1420, FENCE_BASE + 80], sapling: [-430, FENCE_BASE + 70],
      telescope: [2950, FENCE_BASE + 90], easel: [-930, FENCE_BASE + 96], goldfish: [-760, 1500], mailbox: [300, FENCE_BASE + 86],
      rock1: [-300, 1760], rock2: [1700, 1820], rock3: [3000, 1740]
    };
    var ROCK = { rock1: 1, rock2: 0.8, rock3: 1.1 }, LAYOUT = {}, ARRANGE = { on: false, sel: null }, propB = {};
    // feet: the patch of floor it stands on (nobody walks through it); pick: how big it is to grab
    var FOOT = { rock: [150, 46], plant: [78, 28], telescope: [100, 34], easel: [90, 28], goldfish: [72, 24], mailbox: [56, 22] };
    var PICK = { rock: [140, 130], plant: [110, 380], telescope: [130, 280], easel: [110, 340], goldfish: [80, 150], mailbox: [72, 240] };
    var PLANT_IDS = ['fern', 'hydrangea', 'sunflower', 'bonsai', 'sapling'];
    function posOf(id) { var l = LAYOUT[id]; return l && isFinite(l[0]) && isFinite(l[1]) ? l : HOME[id]; }
    function kindOf(id) { return ROCK[id] ? 'rock' : PLANT_IDS.indexOf(id) >= 0 ? 'plant' : id; }
    function propsNow() {
      var L = ['rock1', 'rock2', 'rock3'];
      PLANT_IDS.forEach(function (id) { if (owned[id]) L.push(id); });
      if (owned.telescope) L.push('telescope'); if (owned.easel) L.push('easel'); if (owned.goldfish && !owned.house) L.push('goldfish');
      if (MAIL.has) L.push('mailbox');
      return L.map(function (id) { var p = posOf(id); return { id: id, kind: kindOf(id), x: p[0], y: p[1] }; });
    }
    function rockGroups(id) {
      if (!propB[id]) {
        var r = ROCK[id], fl = new Builder(400 + r * 10), st = new Builder(410 + r * 10);
        for (var ring = 3; ring >= 1; ring--) fl.ell(0, 10, 150 * r + ring * 46, 40 * r + ring * 16, { fill: null, stroke: C.rake, lw: 1.5, g: 'rings', irr: 0.04 });
        st.add([[-120 * r, 16], [-100 * r, -60 * r], [-20 * r, -110 * r], [70 * r, -80 * r], [120 * r, 16]], { fill: C.stone, wob: 5 });
        st.ell(-30 * r, -88 * r, 50 * r, 18 * r, { fill: C.moss, irr: 0.2 });
        propB[id] = { flat: fl.groups, stand: st.groups };
      }
      return propB[id];
    }
    function itemGroups(id) { if (!propB[id]) { var b = new Builder(500 + id.length * 3); ITEMS[id].draw(b, 0, 0); propB[id] = { stand: b.groups }; } return propB[id]; }
    function inPond(x, y, pad) { pad = pad || 0; var dx = (x + 1150) / (330 + pad), dy = (y - 1580) / (104 + pad * 0.4); return dx * dx + dy * dy < 1; }
    function blocked(place, x, y, except) {
      if (place === 'house') return false;
      if (inPond(x, y, 50)) return true;
      return propsNow().some(function (p) { if (p.id === except) return false; var f = FOOT[p.kind], k = (p.kind === 'rock' ? ROCK[p.id] : 1) * persp(p.y), dx = (x - p.x) / (f[0] * k), dy = (y - p.y) / (f[1] * k); return dx * dx + dy * dy < 1; });
    }
    function propAt(x, y) {
      var P = propsNow().sort(function (a, b) { return b.y - a.y; });
      for (var i = 0; i < P.length; i++) {
        var p = P[i], k = PICK[p.kind], g = (p.kind === 'rock' ? ROCK[p.id] : p.kind === 'plant' ? (PSTATE[p.id] || { g: 1 }).g : 1) * persp(p.y);
        if (Math.abs(x - p.x) < k[0] * g && y > p.y - k[1] * g && y < p.y + 40) return p.id;
      }
      return null;
    }
    var FLOOR_Y = [FENCE_BASE + 60, 1900];
    function moveProp(id, x, y) {
      var b = BOUNDS.garden; x = Math.max(b[0] + 90, Math.min(b[1] - 90, x)); y = Math.max(FLOOR_Y[0], Math.min(FLOOR_Y[1], y));
      if (inPond(x, y, 60)) return false;
      LAYOUT[id] = [Math.round(x), Math.round(y)]; return true;
    }
    // things further forward look a little bigger (the same perspective she has)
    function persp(y) { return 1 + (y - 1282) / 1500; }
    function drawProp(c, Xg, p, t) {
      var ps = persp(p.y);
      c.save(); c.translate(p.x, p.y); c.scale(ps, ps); c.translate(-p.x, -p.y);
      if (p.kind === 'plant') drawPlant(c, Xg, p, t, ps);
      else if (p.kind === 'mailbox') drawMailbox(c, Xg, t, p.x, p.y);
      else { var G = p.kind === 'rock' ? rockGroups(p.id) : itemGroups(p.id); c.translate(p.x, p.y); paint(c, G.stand, 2.5 / (Xg.s * ps)); }
      c.restore();
    }
    function drawFlat(c, Xg, p) {
      if (ARRANGE.on) {
        var f = FOOT[p.kind], k = (p.kind === 'rock' ? ROCK[p.id] : 1) * persp(p.y);
        c.save(); c.setLineDash([16 / Xg.s * 0.5, 12 / Xg.s * 0.5]); c.lineWidth = 3 / Xg.s; c.strokeStyle = ARRANGE.sel === p.id ? '#ee6a6a' : 'rgba(91,73,68,0.75)';
        c.fillStyle = ARRANGE.sel === p.id ? 'rgba(238,106,106,0.15)' : 'rgba(255,250,240,0.35)';
        c.beginPath(); c.ellipse(p.x, p.y + 6, f[0] * k + 20, f[1] * k + 10, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
      }
      if (p.kind === 'rock') { var rs = persp(p.y); c.save(); c.translate(p.x, p.y); c.scale(rs, rs); paint(c, rockGroups(p.id).flat, 2.5 / (Xg.s * rs)); c.restore(); }
    }
    function plantGroups(id) { if (!plantB[id]) { var b = new Builder(300 + id.length * 7); ITEMS[id].draw(b, 0, 0); plantB[id] = b.groups; } return plantB[id]; }
    function drawPlant(c, Xg, pl, t, ps) {
      var i = PLANT_IDS.indexOf(pl.id), st = PSTATE[pl.id] || { g: 1, w: 0 }, g = st.g * 1, w = st.w;
      c.save(); c.translate(pl.x, pl.y); c.scale(g, g * (1 - 0.12 * w));
      if (w > 0) { c.transform(1, 0, (i % 2 ? 0.14 : -0.14) * w, 1, 0, 0); c.filter = 'saturate(' + (1 - 0.65 * w).toFixed(2) + ') sepia(' + (0.5 * w).toFixed(2) + ')'; }
      paint(c, plantGroups(pl.id), 2.5 / (Xg.s * g * (ps || 1)));
      c.restore();
    }
    function drawWaterFx(c, Xg, t) {
      waterFx = waterFx.filter(function (f) { return t - f.t0 < 1.6; });
      waterFx.forEach(function (f) {
        var pp = posOf(f.id); if (!pp) return;
        c.fillStyle = 'rgba(120,180,230,0.85)';
        for (var k = 0; k < 14; k++) { var u = ((t - f.t0) * 1.4 + k / 14) % 1, x = pp[0] - 70 + (k * 37 % 140), y = pp[1] - 330 + u * 300; c.beginPath(); c.ellipse(x, y, Math.min(5 / Xg.s * 2, 14), Math.min(9 / Xg.s * 2, 24), 0, 0, Math.PI * 2); c.fill(); }
      });
    }
    function ink(c, Xg, fill) { c.fillStyle = fill; c.fill(); c.lineWidth = Math.min(2.5 / Xg.s * 1.2, 6.5); c.strokeStyle = INK; c.stroke(); }
    function drawCat(c, Xg, cat, t) {
      var y = 1236, x = cat.x, walk = cat.state === 'walk' || cat.state === 'leave', dir = cat.dir || -1, bob = walk ? Math.abs(Math.sin(t * 8)) * 6 : 0, sitting = !walk;
      c.save(); c.translate(x, y - bob); c.scale(dir, 1);
      c.beginPath(); c.ellipse(0, 4, 70, 12, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(20,25,30,0.12)'; c.fill();
      // tail
      c.beginPath(); c.moveTo(56, -30); c.quadraticCurveTo(110, -60 + Math.sin(t * 3) * 14, 92, -110 + Math.sin(t * 3) * 18); c.lineWidth = 15; c.strokeStyle = INK; c.lineCap = 'round'; c.stroke(); c.lineWidth = 15 - 2 * Math.min(2.5 / Xg.s * 1.2, 6.5) * 0.55; c.strokeStyle = '#fbf4ea'; c.stroke();
      // body
      c.beginPath(); if (sitting) c.ellipse(20, -46, 52, 50, 0, 0, Math.PI * 2); else c.ellipse(10, -40, 70, 36, 0, 0, Math.PI * 2); ink(c, Xg, '#fbf4ea');
      if (walk) { [-40, -10, 30, 56].forEach(function (lx, k) { c.beginPath(); c.rect(lx - 8, -14 + (k % 2 ? Math.sin(t * 8) : -Math.sin(t * 8)) * 6, 16, 22); ink(c, Xg, '#fbf4ea'); }); }
      c.beginPath(); c.ellipse(28, -40, 22, 16, 0, 0, Math.PI * 2); c.fillStyle = '#f2b98a'; c.fill();   // a patch
      // head
      var hx = sitting ? -14 : -54, hy = sitting ? -104 : -74;
      c.beginPath(); c.moveTo(hx - 30, hy - 14); c.lineTo(hx - 34, hy - 52); c.lineTo(hx - 8, hy - 30); c.lineTo(hx + 14, hy - 32); c.lineTo(hx + 34, hy - 52); c.lineTo(hx + 30, hy - 12); c.closePath(); ink(c, Xg, '#fbf4ea');
      c.beginPath(); c.ellipse(hx, hy, 38, 32, 0, 0, Math.PI * 2); ink(c, Xg, '#fbf4ea');
      c.fillStyle = INK;
      if (cat.state === 'eat' || cat.state === 'purr') { c.lineWidth = Math.min(3 / Xg.s * 0.5, 4); c.beginPath(); c.arc(hx - 14, hy - 2, 7, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); c.beginPath(); c.arc(hx + 14, hy - 2, 7, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
      else { c.beginPath(); c.arc(hx - 14, hy - 2, 4.5, 0, 7); c.arc(hx + 14, hy - 2, 4.5, 0, 7); c.fill(); }
      c.beginPath(); c.moveTo(hx - 5, hy + 8); c.lineTo(hx + 5, hy + 8); c.lineTo(hx, hy + 13); c.closePath(); c.fillStyle = '#f39ab6'; c.fill();
      if (cat.state === 'eat') { c.beginPath(); c.ellipse(hx - 4, 0, 34, 10, 0, 0, Math.PI * 2); ink(c, Xg, '#a9c3f0'); }
      c.restore();
      if (cat.state === 'purr' && Math.sin(t * 4) > 0) { c.font = '700 40px Mali, sans-serif'; c.fillStyle = INK; c.textAlign = 'center'; c.fillText('♪', x + (sitting ? -10 : -50) * dir, y - 180); }
    }
    function drawBird(c, Xg, b, t) {
      var y = FENCE_BASE - 112, x = b.x, fly = b.fly ? (Date.now() - b.fly) / 1000 : 0;
      c.save(); c.translate(x + fly * 600, y - fly * 520);
      var hop = fly ? 0 : Math.max(0, Math.sin(t * 2 + b.hop) * 2 - 1.6) * 30;
      c.translate(0, -hop);
      c.beginPath(); c.ellipse(0, 0, 26, 20, 0, 0, Math.PI * 2); ink(c, Xg, '#c9a98e');
      c.beginPath(); c.ellipse(-16, -14, 15, 14, 0, 0, Math.PI * 2); ink(c, Xg, '#c9a98e');
      c.fillStyle = INK; c.beginPath(); c.arc(-20, -16, 3, 0, 7); c.fill();
      c.beginPath(); c.moveTo(-30, -12); c.lineTo(-42, -8); c.lineTo(-30, -6); c.fillStyle = '#f6a046'; c.fill();
      c.beginPath(); c.moveTo(4, -6); c.quadraticCurveTo(18, fly ? -40 + Math.sin(t * 30) * 30 : -12, 30, -2); ink(c, Xg, '#b39278');
      c.restore();
    }
    function drawTanuki(c, Xg, tk, t) {
      var x = tk.x + (Date.now() - tk.start) / 1000 * tk.v, y = 1300, bob = Math.abs(Math.sin(t * 5)) * 5;
      c.save(); c.translate(x, y - bob);
      c.beginPath(); c.ellipse(70, -40, 40, 22, -0.4, 0, Math.PI * 2); ink(c, Xg, '#8d7a68');
      c.beginPath(); c.ellipse(0, -50, 76, 50, 0, 0, Math.PI * 2); ink(c, Xg, '#a38d77');
      c.beginPath(); c.ellipse(-70, -86, 40, 36, 0, 0, Math.PI * 2); ink(c, Xg, '#a38d77');
      c.beginPath(); c.ellipse(-78, -88, 26, 14, 0, 0, Math.PI * 2); c.fillStyle = '#5b4944'; c.fill();
      c.fillStyle = '#fffaf0'; c.beginPath(); c.arc(-84, -90, 4, 0, 7); c.arc(-66, -90, 4, 0, 7); c.fill();
      c.beginPath(); c.ellipse(-104, -78, 9, 7, 0, 0, Math.PI * 2); c.fillStyle = INK; c.fill();
      [-40, 40].forEach(function (lx, k) { c.beginPath(); c.rect(lx - 10, -12 + (k ? Math.sin(t * 9) : -Math.sin(t * 9)) * 5, 20, 22); ink(c, Xg, '#5b4944'); });
      c.restore();
    }
    function drawMailbox(c, Xg, t, x, y) {
      if (!MAIL.has) return;
      c.beginPath(); c.rect(x - 8, y - 130, 16, 130); ink(c, Xg, '#b98c66');
      c.beginPath(); c.moveTo(x - 60, y - 120); c.lineTo(x - 60, y - 190); c.quadraticCurveTo(x, y - 236, x + 60, y - 190); c.lineTo(x + 60, y - 120); c.closePath(); ink(c, Xg, '#ee6a6a');
      c.beginPath(); c.ellipse(x, y - 160, 30, 8, 0, 0, Math.PI * 2); c.fillStyle = '#5b4944'; c.fill();
      if (MAIL.flag) { var wv = Math.sin(t * 3) * 0.08; c.save(); c.translate(x + 62, y - 150); c.rotate(-0.1 + wv); c.beginPath(); c.rect(0, -70, 8, 70); ink(c, Xg, '#c0b8ae'); c.beginPath(); c.rect(8, -70, 38, 26); ink(c, Xg, '#ffe08a'); c.restore(); }
    }
    function drawKite(c, Xg, t) {
      if (!owned.kite) return;
      var kx = 900 + Math.sin(t * 0.7) * 60, ky = 560 + Math.sin(t * 1.1) * 30, ax = 760, ay = FENCE_TOP + 20;
      c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + kx) / 2 - 80, (ay + ky) / 2 + 60, kx, ky + 90); c.lineWidth = 2.5 / Xg.s * 1.2; c.strokeStyle = INK; c.stroke();
      c.save(); c.translate(kx, ky); c.rotate(Math.sin(t * 1.3) * 0.12);
      c.beginPath(); c.moveTo(0, -90); c.lineTo(70, 0); c.lineTo(0, 90); c.lineTo(-70, 0); c.closePath(); ink(c, Xg, '#f39ab6');
      c.beginPath(); c.moveTo(0, -90); c.lineTo(0, 90); c.moveTo(-70, 0); c.lineTo(70, 0); c.lineWidth = 2; c.stroke();
      for (var k = 0; k < 4; k++) { c.beginPath(); c.ellipse(Math.sin(t * 3 + k) * 14, 110 + k * 34, 12, 7, 0.4, 0, Math.PI * 2); ink(c, Xg, ['#ffe08a', '#a9d9f2'][k % 2]); }
      c.restore();
    }
    function drawBirds(c, Xg, t) { if (VIS && VIS.birds) VIS.birds.forEach(function (b) { drawBird(c, Xg, b, t); }); }
    function visitorsNow() {
      var L = [];
      if (VIS && VIS.cat && VIS.cat.state !== 'gone') L.push({ y: 1236, draw: function (c, Xg, t) { drawVisitors(c, Xg, t, 'cat'); } });
      if (VIS && VIS.tanuki) L.push({ y: 1300, draw: function (c, Xg, t) { drawVisitors(c, Xg, t, 'tanuki'); } });
      return L;
    }
    function drawVisitors(c, Xg, t, only) {
      if (!VIS) return;
      if (VIS.cat && only === 'cat') {
        var cat = VIS.cat, dt = 1 / 60;
        if (cat.state === 'walk') { var d = cat.tx - cat.x; cat.dir = d < 0 ? 1 : -1; cat.x += Math.sign(d) * Math.min(Math.abs(d), 140 * dt * 1.6); if (Math.abs(d) < 4) cat.state = 'sit'; }
        else if (cat.state === 'leave') { cat.dir = -1; cat.x += 220 * dt; if (cat.x > 3700) cat.state = 'gone'; }
        else if ((cat.state === 'eat' || cat.state === 'purr') && Date.now() > cat.eatUntil) cat.state = 'sit';
        else if (cat.state === 'sit' && VIS.catFriend && Math.random() < 0.0015) { cat.tx = 660 + (Math.random() < 0.5 ? -260 : 260); cat.state = 'walk'; }
        if (cat.state === 'sit') cat.dir = cat.x > 660 ? 1 : -1;
        drawCat(c, Xg, cat, t);
      }
      if (VIS.tanuki && only === 'tanuki') drawTanuki(c, Xg, VIS.tanuki, t);
    }
    function drawWall(c, Xg) {
      WALL.forEach(function (p, i) {
        var sp = WALL_SPOTS[i]; if (!sp) return;
        var w = 130, h = 104, x = sp[0] - w / 2, y = sp[1];
        c.save(); c.translate(sp[0], y); c.rotate(((i * 37) % 7 - 3) * 0.012); c.translate(-sp[0], -y);
        c.beginPath(); c.rect(x - 12, y - 12, w + 24, h + 24); ink(c, Xg, '#d8ae86');
        c.fillStyle = '#fffaf0'; c.fillRect(x - 3, y - 3, w + 6, h + 6);
        if (p.img && p.img.complete && p.img.naturalWidth) {
          var iw = p.img.naturalWidth, ih = p.img.naturalHeight, k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
          c.drawImage(p.img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
        }
        c.restore();
      });
    }
    function drawFireworks(c, V, t, horizon) {
      if (!FW || V.reduce) { fw.length = 0; return; }
      var tn = Date.now() / 1000;
      if (tn > fwNext) {
        fwNext = tn + 0.6 + Math.random() * 1.2;
        var cols = ['#ff8fb1', '#ffe08a', '#a9d9f2', '#b9dc9c', '#d7c7f5', '#ffb36b'];
        fw.push({ x: V.w * (0.15 + Math.random() * 0.7), y: Math.max(50, horizon * (0.18 + Math.random() * 0.45)), t0: tn, col: cols[Math.floor(Math.random() * cols.length)], n: 26 + Math.floor(Math.random() * 14), r: 70 + Math.random() * 70 });
      }
      fw = fw.filter(function (f) { return tn - f.t0 < 2.4; });
      c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      fw.forEach(function (f) {
        var u = tn - f.t0;
        if (u < 0.5) { c.fillStyle = 'rgba(255,240,200,0.9)'; c.beginPath(); c.arc(f.x, horizon - (horizon - f.y) * (u / 0.5), 3, 0, 7); c.fill(); return; }
        var v = (u - 0.5) / 1.9, al = Math.max(0, 1 - v), rr = f.r * Math.sqrt(Math.min(1, v * 2.2));
        c.globalAlpha = al; c.fillStyle = f.col;
        for (var k = 0; k < f.n; k++) { var a = k / f.n * Math.PI * 2, px = f.x + Math.cos(a) * rr, py = f.y + Math.sin(a) * rr + v * v * 40; c.beginPath(); c.arc(px, py, 3.2 * (1 - v * 0.5), 0, 7); c.fill(); }
        c.globalAlpha = 1;
      });
    }
    var leaves = [];
    function drawWind(c, V, t) {
      if (EVENTS.indexOf('typhoon') < 0 || V.reduce || wxKind() !== 'storm') { leaves.length = 0; return; }
      while (leaves.length < 14) leaves.push({ x: Math.random() * V.w - V.w, y: Math.random() * V.h * 0.8, v: 500 + Math.random() * 500, r: Math.random() * 6, col: ['#9fd28a', '#f6a46f', '#c9b07a'][leaves.length % 3] });
      leaves.forEach(function (l) {
        l.x += l.v / 60; l.y += Math.sin(t * 3 + l.r) * 2; l.r += 0.2; if (l.x > V.w + 40) { l.x = -40; l.y = Math.random() * V.h * 0.8; }
        c.save(); c.translate(l.x, l.y); c.rotate(l.r); c.beginPath(); c.ellipse(0, 0, 12, 5, 0, 0, Math.PI * 2); c.fillStyle = l.col; c.fill(); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke(); c.restore();
      });
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2;
      for (var k = 0; k < 8; k++) { var y = (k * 97 + t * 40) % V.h, x = ((t * 900 + k * 230) % (V.w + 400)) - 200; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 60, y - 10, x + 140, y); c.stroke(); }
    }
    function hit(x, y, place) {
      if (place === 'house') return null;
      if (VIS && VIS.cat && Math.abs(x - VIS.cat.x) < 110 && y > 1100 && y < 1290) return 'cat';
      var mb = posOf('mailbox');
      if (MAIL.has && Math.abs(x - mb[0]) < 80 && y > mb[1] - 250 && y < mb[1] + 20) return 'mailbox';
      for (var i = 0; i < PLANT_IDS.length; i++) { var id = PLANT_IDS[i], pp = posOf(id), st = PSTATE[id] || { g: 1 }; if (owned[id] && Math.abs(x - pp[0]) < 130 * st.g && y > pp[1] - 400 * st.g && y < pp[1] + 30) return 'plant:' + id; }
      var other = propAt(x, y); if (other) return 'thing:' + other;
      return null;
    }
    function draw(c, V, drawHer) {
      build(); lastT = V.t;
      var h = skyHour(), t = V.t, n = nightness(h), inside = V.place === 'house', wk = wxKind();
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.lineJoin = 'round'; c.lineCap = 'round';
      var Xg = layerXf(V, 1), horizon = layerXf(V, 0.45).glue - (FENCE_TOP - LAKE_TOP) * layerXf(V, 0.45).s;
      if (!inside) {
        ['fuji', 'lake', 'mid'].forEach(function (k) {
          var L = layers[k], X = layerXf(V, L.d); setXf(c, V, X); paint(c, L.groups, 2.5 / X.s);
          if (k === 'lake') drawBoat(c, t, X.s);
          if (k === 'mid' && wk === 'fog') { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(236,238,244,0.45)'; c.fillRect(0, 0, c.canvas.width, c.canvas.height); c.restore(); }
        });
        setXf(c, V, Xg); paint(c, layers.ground.groups, 2.5 / Xg.s);
        var dg = deco(); if (dg) paint(c, dg, 2.5 / Xg.s);
        c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
        GROUND_TEXT.forEach(function (tx) { c.font = '700 ' + tx.size + 'px Mali, "M PLUS Rounded 1c", sans-serif'; c.fillText(tx.text, tx.x, tx.y); });
        drawKoi(c, V.reduce ? 0 : t, Xg.s);
        var P = propsNow();
        P.forEach(function (p) { drawFlat(c, Xg, p); });
        drawKite(c, Xg, t); drawBirds(c, Xg, t);
        var stand = P.map(function (p) { return { y: p.y, draw: function (c2, X2, t2) { drawProp(c2, X2, p, t2); } }; }).concat(visitorsNow());
        stand.push({ y: V.herY != null ? V.herY : 1282, her: true });
        stand.sort(function (a, b) { return a.y - b.y || (a.her ? 1 : 0) - (b.her ? 1 : 0); });
        stand.forEach(function (o) { if (o.her) { drawHer(); setXf(c, V, Xg); c.lineJoin = 'round'; c.lineCap = 'round'; } else o.draw(c, Xg, t); });
        drawWaterFx(c, Xg, t);
      } else {
        setXf(c, V, Xg); paint(c, layers.room.groups, 2.5 / Xg.s);
        // the window shows the real sky
        var W = WINDOW, cols = skyCols(h), sg = c.createLinearGradient(0, W.y, 0, W.y + W.h);
        sg.addColorStop(0, rgb(cols[0])); sg.addColorStop(1, rgb(cols[1])); c.fillStyle = sg; c.fillRect(W.x, W.y, W.w, W.h);
        c.fillStyle = '#aebbe1'; c.strokeStyle = INK; c.lineWidth = 2.5 / Xg.s;
        c.beginPath(); c.moveTo(W.x + 20, W.y + W.h); c.quadraticCurveTo(W.x + 150, W.y + 250, W.x + 195, W.y + 235); c.lineTo(W.x + 225, W.y + 235); c.quadraticCurveTo(W.x + 270, W.y + 250, W.x + 400, W.y + W.h); c.fill(); c.stroke();
        c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(W.x + 158, W.y + 270); c.quadraticCurveTo(W.x + 185, W.y + 240, W.x + 195, W.y + 235); c.lineTo(W.x + 225, W.y + 235); c.quadraticCurveTo(W.x + 242, W.y + 245, W.x + 262, W.y + 270); c.lineTo(W.x + 235, W.y + 262); c.lineTo(W.x + 210, W.y + 278); c.lineTo(W.x + 185, W.y + 262); c.closePath(); c.fill(); c.stroke();
        var smw = sunMoon(h, W.w, W.h * 0.7);
        if (smw.sun) { c.fillStyle = '#ffe28a'; c.beginPath(); c.arc(W.x + smw.sun.x, W.y + smw.sun.y, 26, 0, Math.PI * 2); c.fill(); c.stroke(); }
        if (smw.moon) { c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(W.x + smw.moon.x, W.y + smw.moon.y, 22, 0, Math.PI * 2); c.fill(); c.stroke(); }
        paint(c, lattice(), 2.5 / Xg.s);
        drawWall(c, Xg);
        if (RECORD && V.music) { c.save(); c.translate(RECORD.x, RECORD.y); c.scale(1, 0.2); c.rotate(t * 4); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3 / Xg.s; c.beginPath(); c.arc(0, 0, 60, 0, 1.2); c.stroke(); c.restore(); }
        if (TEA && !V.reduce) { c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 3 / Xg.s; for (var st = 0; st < 2; st++) { var o = ((t * 0.5 + st * 0.5) % 1); c.globalAlpha = 1 - o; c.beginPath(); c.moveTo(TEA.x + st * 14, TEA.y - o * 90); c.quadraticCurveTo(TEA.x + 18 + st * 14, TEA.y - o * 90 - 20, TEA.x + st * 14, TEA.y - o * 90 - 40); c.stroke(); } c.globalAlpha = 1; }
      }
      // her (in the garden she was already drawn in depth order)
      if (inside) drawHer();
      c.setTransform(V.dpr, 0, 0, V.dpr, V.shx * V.dpr, V.shy * V.dpr);
      drawFalls(c, V, t);
      if (!inside) { drawRain(c, V, t, wk); drawWind(c, V, t); }
      // time-of-day wash over the drawing (not the sky)
      c.setTransform(1, 0, 0, 1, 0, 0);
      var wa = wash(h);
      if (inside) { var lit = owned.lamp; wa = lit ? [255, 196, 140, wa[3] * 0.35] : [wa[0], wa[1], wa[2], wa[3] * 0.8]; }
      if (wa[3] > 0.005) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = rgb([wa[0], wa[1], wa[2]], wa[3]); c.fillRect(0, 0, c.canvas.width, c.canvas.height); }
      // paper grain
      if (!paperPat) paperPat = c.createPattern(paper, 'repeat');
      if (!window.__noPaper) { c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.07; c.fillStyle = paperPat; c.fillRect(0, 0, c.canvas.width, c.canvas.height); c.globalAlpha = 1; }
      // the sky goes behind everything (fireworks just in front of it)
      c.globalCompositeOperation = 'destination-over';
      if (!inside) drawFireworks(c, V, t, Math.max(40, horizon));
      c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      var smn = inside ? null : drawSky(c, V, Math.max(40, horizon), h, t);
      if (inside) { c.fillStyle = C.roomWall; c.fillRect(0, 0, V.w, V.h); }
      c.globalCompositeOperation = 'source-over';
      // lights at night
      if (n > 0.3) {
        c.globalCompositeOperation = 'lighter';
        if (!inside) {
          setXf(c, V, Xg);
          LANTERNS.forEach(function (lx) { glow(c, lx, FENCE_BASE - 166, 120, 'rgba(255,214,140,' + (0.55 * n) + ')'); });
          if (owned.house) HOUSE_GLOW.forEach(function (g2) { if (V.herInside || owned.lamp || g2.door === undefined) { c.fillStyle = 'rgba(255,205,120,' + (0.35 * n) + ')'; c.beginPath(); c.ellipse(g2.x, g2.y, g2.rx, g2.ry, 0, 0, Math.PI * 2); c.fill(); } });
          if (EVENTS.indexOf('fireflies') >= 0 && !V.reduce) for (var f = 0; f < 44; f++) {
            var fx = 660 + (f - 22) * 130 + Math.sin(t * 0.4 + f * 1.7) * 120 + (V.focusX || 0), fy = FENCE_BASE - 60 + Math.sin(t * 0.6 + f) * 120 + (f % 4) * 70;
            var a2 = n * (0.5 + 0.5 * Math.sin(t * 2.3 + f * 2.1)); glow(c, fx, fy, 22, 'rgba(230,255,160,' + (0.8 * a2) + ')');
          }
        } else if (owned.lamp && LAMP_ON) { setXf(c, V, Xg); glow(c, LAMP_ON.x, LAMP_ON.y, 420, 'rgba(255,200,120,' + (0.25 * n) + ')'); }
        c.globalCompositeOperation = 'source-over';
      }
      if (FW && !inside && fw.length) { c.globalCompositeOperation = 'lighter'; c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); fw.forEach(function (f) { var u = Date.now() / 1000 - f.t0; if (u > 0.5 && u < 1.4) glow(c, f.x, f.y, f.r * 2.2, 'rgba(255,220,200,' + (0.12 * (1 - (u - 0.5) / 0.9)) + ')'); }); c.globalCompositeOperation = 'source-over'; }
      // lightning
      if (wk === 'storm' && !inside && !V.reduce) {
        if (flash <= 0 && Math.random() < 0.0016) flash = 1;
        if (flash > 0) { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgba(255,255,255,' + (0.55 * flash) + ')'; c.fillRect(0, 0, c.canvas.width, c.canvas.height); flash -= 0.06; }
      }
      // paper lanterns and pumpkins glow at night
      if (n > 0.3 && !inside && DECO_GLOW.length) { c.globalCompositeOperation = 'lighter'; setXf(c, V, Xg); DECO_GLOW.forEach(function (g3) { glow(c, g3[0], g3[1], g3[2], 'rgba(255,170,110,' + (0.5 * n) + ')'); }); c.globalCompositeOperation = 'source-over'; }
      c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      return smn;
    }
    var drops = [], flash = 0;
    function drawRain(c, V, t, wk) {
      var ty = EVENTS.indexOf('typhoon') >= 0, want = wk === 'storm' ? (ty ? 170 : 120) : wk === 'rain' ? 80 : wk === 'drizzle' ? 36 : 0;
      if (!want || V.reduce) { drops.length = 0; return; }
      while (drops.length < want) drops.push({ x: Math.random() * (V.w + 200) - 100, y: Math.random() * V.h, v: 900 + Math.random() * 500, l: wk === 'drizzle' ? 8 + Math.random() * 6 : 16 + Math.random() * 14 });
      if (drops.length > want) drops.length = want;
      c.strokeStyle = 'rgba(120,150,190,0.55)'; c.lineWidth = wk === 'drizzle' ? 1.2 : 1.6; c.beginPath();
      drops.forEach(function (d) {
        d.y += d.v / 60; d.x -= d.v / 60 * (ty ? -0.6 : 0.18); if (d.x > V.w + 120) d.x = -100;
        if (d.y > V.h + 20) { d.y = -20; d.x = Math.random() * (V.w + 200) - 100; }
        c.moveTo(d.x, d.y); c.lineTo(d.x + d.l * 0.18, d.y - d.l);
      });
      c.stroke();
    }
    // ---------- special days: little decorations in the garden ----------
    var decoB = null, decoKey = '', DECO_GLOW = [];
    function deco() {
      var key = EVENTS.join(',');
      if (key === decoKey) return decoB;
      decoKey = key; DECO_GLOW = []; if (!EVENTS.length) return (decoB = null);
      var b = new Builder(77), y0 = FENCE_BASE + 72, X = 290, X2 = 290;
      EVENTS.forEach(function (ev) {
        if (ev === 'newyear') {      // kadomatsu
          b.add([[X - 110, y0], [X + 110, y0], [X + 90, y0 - 130], [X - 90, y0 - 130]], { fill: '#e8d39a', wob: 3 });
          for (var i = 0; i < 4; i++) b.line([[X - 100, y0 - 30 - i * 26], [X + 100, y0 - 30 - i * 26]], { stroke: '#a9874f', lw: 1.6, g: 'straw' });
          [[-40, 330], [10, 420], [55, 290]].forEach(function (q) { b.add([[X + q[0] - 24, y0 - 120], [X + q[0] + 24, y0 - 120], [X + q[0] + 24, y0 - q[1] + 30], [X + q[0] - 24, y0 - q[1]]], { fill: C.bamboo, wob: 1, g: 'kbam' }); });
          b.canopy(X - 90, y0 - 160, 60, ['#80b380', '#94c191', '#80b380']); b.canopy(X + 100, y0 - 150, 55, ['#80b380', '#94c191', '#80b380']);
          b.ell(X - 70, y0 - 150, 16, 16, { fill: '#ee6a6a' }); b.ell(X + 80, y0 - 140, 14, 14, { fill: '#ee6a6a' });
        } else if (ev === 'tanabata') {   // a bamboo branch with wishes
          b.line([[X2, y0], [X2 + 20, y0 - 520]], { stroke: '#7fb36a', lw: 3 });
          for (var j = 0; j < 7; j++) { var lx = X2 + 10 + (j % 2 ? 1 : -1) * (40 + j * 12), ly = y0 - 480 + j * 52; b.add([[X2 + 14, ly - 20], [lx, ly], [X2 + 14, ly + 10]], { fill: '#a3d48c', wob: 2, g: 'tleaf' }); }
          ['#f8c4d3', '#ffe08a', '#b9dc9c', '#a9d9f2', '#d7c7f5', '#f39ab6', '#ffffff'].forEach(function (col, k) { var tx = X2 - 130 + k * 44, ty = y0 - 430 + (k % 3) * 70; b.line([[tx + 10, ty - 30], [tx + 10, ty]], { stroke: '#8a6a55', lw: 1, g: 'tstr' }); b.rect(tx, ty, 22, 90, { fill: col, g: 'tz' + k }); });
        } else if (ev === 'obon' || ev === 'summerfest') {   // a string of paper lanterns
          var pts = []; for (var u = 0; u <= 10; u++) pts.push([-900 + u * 280, FENCE_TOP - 150 + Math.sin(u / 10 * Math.PI) * 50]);
          b.line(pts, { stroke: '#8a6a55', lw: 1.6 });
          for (var l = 0; l < 10; l++) { var px = -900 + l * 280 + 140, py = FENCE_TOP - 140 + Math.sin((l + 0.5) / 10 * Math.PI) * 50 + 40; b.ell(px, py, 38, 50, { fill: l % 2 ? '#ffffff' : '#ee6a6a', g: 'lan' + (l % 2) }); b.rect(px - 22, py - 56, 44, 10, { fill: '#5b4944', g: 'lancap' }); b.rect(px - 22, py + 46, 44, 10, { fill: '#5b4944', g: 'lancap' }); DECO_GLOW.push([px, py, 110]); }
        } else if (ev === 'tsukimi') {     // dango on a stand and pampas grass
          b.rect(X - 90, y0 - 60, 180, 60, { fill: C.wood }); b.add([[X - 110, y0 - 60], [X + 110, y0 - 60], [X + 90, y0 - 80], [X - 90, y0 - 80]], { fill: C.woodDark });
          [[-60, 0], [0, 0], [60, 0], [-30, -52], [30, -52], [0, -104]].forEach(function (q) { b.ell(X + q[0], y0 - 116 + q[1], 30, 28, { fill: '#fffaf0', g: 'dg' }); });
          for (var gq = 0; gq < 5; gq++) { var gx = X - 220 + gq * 22; b.line([[gx, y0], [gx + 30 - gq * 10, y0 - 330 - gq * 20]], { stroke: '#c9b07a', lw: 1.6, g: 'sus' }); b.ell(gx + 30 - gq * 10, y0 - 340 - gq * 20, 14, 44, { fill: '#efe2bf', g: 'susf' }); }
        } else if (ev === 'halloween') {   // a jack-o'-lantern
          b.ell(X, y0 - 90, 120, 96, { fill: '#f6a046' }); b.line([[X - 40, y0 - 180], [X - 30, y0 - 10]], { stroke: '#d88131', lw: 1.6, g: 'pk' }); b.line([[X + 40, y0 - 180], [X + 30, y0 - 10]], { stroke: '#d88131', lw: 1.6, g: 'pk' });
          b.rect(X - 10, y0 - 220, 20, 40, { fill: '#7fb36a' });
          b.add([[X - 60, y0 - 120], [X - 30, y0 - 140], [X - 20, y0 - 110]], { fill: '#5b4944', g: 'pkf' }); b.add([[X + 60, y0 - 120], [X + 30, y0 - 140], [X + 20, y0 - 110]], { fill: '#5b4944', g: 'pkf' });
          b.add([[X - 60, y0 - 70], [X - 30, y0 - 54], [X, y0 - 70], [X + 30, y0 - 54], [X + 60, y0 - 70], [X + 30, y0 - 36], [X - 30, y0 - 36]], { fill: '#5b4944', g: 'pkf' });
          DECO_GLOW.push([X, y0 - 90, 220]);
        } else if (ev === 'christmas') {   // a small tree
          b.rect(X - 22, y0 - 70, 44, 70, { fill: C.trunk });
          [[170, 60], [135, 150], [100, 230]].forEach(function (q, k) { b.add([[X - q[0], y0 - q[1]], [X + q[0], y0 - q[1]], [X, y0 - q[1] - q[0] * 1.15]], { fill: '#80b380', g: 'xt' + k }); });
          [[-80, -100], [60, -120], [-30, -190], [40, -230], [0, -150], [-60, -170]].forEach(function (q, k) { b.ell(X + q[0], y0 + q[1], 12, 12, { fill: ['#ee6a6a', '#ffe08a', '#a9d9f2'][k % 3], g: 'orn' + (k % 3) }); });
          b.add([[X, y0 - 380], [X + 14, y0 - 350], [X + 44, y0 - 350], [X + 20, y0 - 332], [X + 28, y0 - 300], [X, y0 - 318], [X - 28, y0 - 300], [X - 20, y0 - 332], [X - 44, y0 - 350], [X - 14, y0 - 350]], { fill: '#ffe08a', wob: 0 });
          DECO_GLOW.push([X, y0 - 350, 120]);
        } else if (ev === 'birthday' || ev === 'anniversary') {   // bunting
          var bp = []; for (var v = 0; v <= 8; v++) bp.push([-560 + v * 260, FENCE_TOP - 210 + Math.sin(v / 8 * Math.PI) * 60]);
          b.line(bp, { stroke: '#8a6a55', lw: 1.6 });
          for (var f = 0; f < 16; f++) { var fx = -560 + f * 130 + 30, fy = FENCE_TOP - 205 + Math.sin((f + 0.5) / 16 * Math.PI) * 60; b.add([[fx - 34, fy], [fx + 34, fy], [fx, fy + 70]], { fill: ['#f8c4d3', '#ffe08a', '#b9dc9c', '#a9d9f2', '#d7c7f5'][f % 5], wob: 1, g: 'bf' + (f % 5) }); }
        }
      });
      decoB = b.groups; return decoB;
    }
    function glow(c, x, y, r, col) { var g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }

    // a little picture of an item, for the shop
    function icon(id, cv2) {
      var b = new Builder(200 + id.length), g = cv2.getContext('2d'), saveOwned = owned, keep = [LAMP_ON, TEA, RECORD, HOUSE_GLOW];
      if (id === 'books') { owned = { books: 2 }; drawBooks(b, -220, 280, 440); owned = saveOwned; }
      else if (id === 'house') buildHouse(b, 0, 0);
      else if (ITEMS[id].inside) ITEMS[id].draw(b);
      else ITEMS[id].draw(b, 0, 0);
      var bx = b.box, bw = bx[2] - bx[0], bh = bx[3] - bx[1], pad = 10, sc = Math.min((cv2.width - pad * 2) / bw, (cv2.height - pad * 2) / bh);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv2.width, cv2.height);
      g.setTransform(sc, 0, 0, sc, (cv2.width - bw * sc) / 2 - bx[0] * sc, (cv2.height - bh * sc) / 2 - bx[1] * sc);
      g.lineJoin = 'round'; g.lineCap = 'round';
      paint(g, b.groups, 2.2 / sc);
      LAMP_ON = keep[0]; TEA = keep[1]; RECORD = keep[2]; HOUSE_GLOW = keep[3];
    }

    return {
      hourNow: hourNow, season: season,
      setHour: function (h) { HOUR_OVERRIDE = h == null ? null : ((h % 24) + 24) % 24; },
      setSeason: function (s) { SEASON_OVERRIDE = s || null; },
      get previewing() { return HOUR_OVERRIDE != null || SEASON_OVERRIDE != null; },
      invalidate: function () { builtKey = ''; },
      setOwned: function (o) { owned = Object.assign({}, o || {}); builtKey = ''; },
      bounds: function (place) { return BOUNDS[place === 'house' ? 'house' : 'garden']; },
      door: function () { return HOUSE.door; },
      nightness: function () { return nightness(skyHour()); }, skyHour: skyHour,
      setSun: function (rise, set) { SUN = rise != null && set != null ? { rise: rise, set: set } : null; },
      setWeather: function (w) { WX = w || null; }, weather: wxKind,
      setEvents: function (list) { EVENTS = (list || []).slice().sort(); },
      draw: draw, icon: icon, items: ITEMS, INK: INK, hit: hit,
      setPlants: function (st) { PSTATE = st || {}; }, water: function (id) { waterFx.push({ id: id, t0: lastT }); },
      depth: function (place) { return place === 'house' ? [-40, 150] : [-70, 560]; },
      blocked: blocked, propAt: propAt, moveProp: moveProp, propName: kindOf, posOf: function (id) { return posOf(id).slice(); },
      setLayout: function (m) { LAYOUT = {}; Object.keys(m || {}).forEach(function (k) { if (HOME[k] && Array.isArray(m[k])) LAYOUT[k] = m[k].slice(0, 2); }); },
      layout: function () { return JSON.parse(JSON.stringify(LAYOUT)); }, resetLayout: function () { LAYOUT = {}; },
      setArrange: function (on, sel) { ARRANGE.on = !!on; ARRANGE.sel = sel || null; },
      setVisitors: function (v) { VIS = v; }, setMail: function (m) { MAIL = m || { has: false }; }, setWall: function (list) { WALL = list || []; }, setFireworks: function (on) { FW = !!on; }
    };
  })();
