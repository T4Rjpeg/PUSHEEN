'use strict';
  // ===================== CORE: Pusheen's body, physics, faces, touch =====================
  var cv = document.getElementById('stage'), ctx = cv.getContext('2d');
  var IMG = {}, ALPHA = {};
  var D2R = Math.PI / 180;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function V(x, y) { return { x: x, y: y }; }
  function rot(v, a) { var c = Math.cos(a), s = Math.sin(a); return V(v.x * c - v.y * s, v.x * s + v.y * c); }
  function dirA(v) { return Math.atan2(v.x, v.y); }
  function fromA(a, l) { return V(Math.sin(a) * l, Math.cos(a) * l); }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { var s = Math.random() * list.reduce(function (q, x) { return q + x[1]; }, 0); for (var i = 0; i < list.length; i++) { s -= list[i][1]; if (s <= 0) return list[i][0]; } return list[0][0]; }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function oneOf(a) { return a[Math.floor(Math.random() * a.length)]; }

  // ---------- rig ----------
  var J = RIG.joints;
  var WAIST = V(J.waist[0], J.waist[1]), NECK = V(J.neck[0], J.neck[1]);
  var SKIRT = V(J.skirtTop[0], J.skirtTop[1]), LEGS = V(J.legsTop[0], J.legsTop[1]);
  var SHOULDER = { L: V(J.shoulderL[0], J.shoulderL[1]), R: V(J.shoulderR[0], J.shoulderR[1]) };
  var COM = V(666, 640), HAIR_PIVOT = V(652, 260);
  var SIDE = { L: -1, R: 1 };
  var ARM = {};
  ['L', 'R'].forEach(function (k) {
    var a = RIG.arms[k], ev = V(a.upper.elbow[0], a.upper.elbow[1]);
    ARM[k] = { up: a.upper, fo: a.fore, ev: ev, l1: Math.hypot(ev.x, ev.y), eA0: dirA(ev), fA0: a.fore.a0 * D2R, l2: a.fore.len };
  });
  var BEND_SOFT = 100 * D2R, BEND_MAX = 152 * D2R;               // elbow only: slows from 100°, stops at 152°
  var CENTER = V(660, 640), CHAR_H = 1250, CHAR_W = 640, GROUND = 1282, ANCHOR = 0.53;

  // ---------- state ----------
  var body = { x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, sq: 0, sqv: 0 };
  var head = { r: 0, v: 0, target: 0, shift: 0, shiftT: 0, shiftY: 0, shiftYT: 0, face: 'main' };
  var skirt = { r: 0, v: 0 }, legs = { r: 0, v: 0 }, hair = { r: 0, v: 0 };
  var arms = {
    L: { e: -14 * D2R, ev: 0, f: -11 * D2R, fv: 0, z: 'back', pose: 'down' },
    R: { e: 14 * D2R, ev: 0, f: 11 * D2R, fv: 0, z: 'back', pose: 'down' }
  };
  var lean = 0, t = 0, grab = null;
  var cam = { s: 1, x: 0, y: 0, shake: 0, free: 0 }, view = { w: 0, h: 0, k: 1, dpr: 1 };
  var PLACE = { name: 'garden', fade: 0, busy: false };
  var prevShoulder = { L: null, R: null }, shoulderAcc = { L: V(0, 0), R: V(0, 0) }, prevShoulderV = { L: V(0, 0), R: V(0, 0) };
  var prevWaistV = V(0, 0), waistAcc = V(0, 0), prevWaist = null;
  var finger = { v: V(0, 0), a: V(0, 0), last: null };
  var react = null, fx = [];
  var wander = { x: 0, target: 0, next: 8, dir: 0, goal: null };
  function wanderRange() { var b = SCENE.bounds(PLACE.name); return [b[0] - 660 + 260, b[1] - 660 - 260]; }
  var vibe = { until: 0, likes: true, nextNote: 0 };
  // body-level mood: awake / asleep / fedUp. Temper (calm, grumpy, sad...) comes from her brain.
  var mood = { state: Math.random() < 0.5 ? 'asleep' : 'awake', until: 0, boops: [], upset: 0, reliefAt: 0, lastTouch: 0, nextZ: 1, sleepSide: Math.random() < 0.5 ? -1 : 1, flail: 0 };
  var TEMPER = { name: 'calm' };
  var SLEEP_AFTER = 45, FEDUP_FOR = [3, 7];
  var listeners = [];
  function emit(type, data) { listeners.forEach(function (fn) { try { fn(type, data || {}); } catch (e) {} }); }

  // ---------- where things are ----------
  function bodyPt(p) { var r = rot(V((p.x - WAIST.x) * (1 + body.sq * 0.6), (p.y - WAIST.y) * (1 - body.sq)), body.a); return V(WAIST.x + body.x + r.x, WAIST.y + body.y + r.y); }
  function bodyLocal(w) { var r = rot(V(w.x - WAIST.x - body.x, w.y - WAIST.y - body.y), -body.a); return V(WAIST.x + r.x / (1 + body.sq * 0.6), WAIST.y + r.y / (1 - body.sq)); }
  function shoulderW(k) { return bodyPt(SHOULDER[k]); }
  function elbowW(k) { var s = shoulderW(k); var d = fromA(arms[k].e, ARM[k].l1); return V(s.x + d.x, s.y + d.y); }
  function handW(k, d) { var e = elbowW(k); var v = fromA(arms[k].f, d == null ? ARM[k].l2 : d); return V(e.x + v.x, e.y + v.y); }
  function headPt(p) { var r = rot(V(p.x - NECK.x, p.y - NECK.y), head.r); return bodyPt(V(NECK.x + head.shift + r.x, NECK.y + head.shiftY + r.y)); }
  function worldToScreen(p) { var s = view.k * cam.s; return V(view.w / 2 + cam.x + (p.x - CENTER.x) * s, view.h * ANCHOR + cam.y + (p.y - CENTER.y) * s); }
  function toWorld(sx, sy) { var s = view.k * cam.s; return V((sx - view.w / 2 - cam.x) / s + CENTER.x, (sy - view.h * ANCHOR - cam.y) / s + CENTER.y); }

  // ---------- poses ----------
  var POSES = {
    down:  function (k, tt) { var sw = Math.sin(tt * 1.25 + (k === 'L' ? 0 : 0.6)) * 1.2; return [13 + sw, 10 + sw * 1.4]; },
    sleep: function (k, tt) { var sw = Math.sin(tt * 0.6 + (k === 'L' ? 0 : 0.6)) * 0.8; return [9 + sw, 6 + sw]; },
    swing: function (k, tt) { var ph = k === 'L' ? 0 : Math.PI; return [15 + 10 * Math.sin(tt * 2.6 + ph), 11 + 14 * Math.sin(tt * 2.6 + ph - 0.7)]; },
    vibe:  function (k, tt) { var ph = k === 'L' ? 0 : Math.PI; return [18 + 8 * Math.sin(tt * 2 * Math.PI * 1.9 + ph), 30 + 12 * Math.sin(tt * 2 * Math.PI * 1.9 + ph + 0.5)]; },
    crossFront: function (k) { return k === 'L' ? [-2, -66] : [-2, -62]; },
    crossBack:  function (k) { return k === 'L' ? [0, -58] : [0, -54]; },
    rubUp:  function () { return [140, 120]; },
    rub:    function (k, tt) { return [152, 214 + 10 * Math.sin(tt * 7.5)]; },
    rubDown: function () { return [60, 40]; },
    flail:  function (k, tt) { var ph = k === 'L' ? 0 : 1.9; return [75 + 50 * Math.sin(tt * 24 + ph), 95 + 70 * Math.sin(tt * 24 + ph + 0.9)]; }
  };
  var armPlan = { next: 4 }, headPlan = { next: 3 }, leanPlan = { next: 5 }, timers = [];
  function later(sec, fn) { timers.push({ at: t + sec, fn: fn }); }
  function setPose(k, pose) {
    var a = arms[k]; a.pose = pose;
    if (pose === 'crossFront') a.z = 'front';
    else if (a.z === 'front') later(0.7, function () { if (arms[k].pose !== 'crossFront') arms[k].z = 'back'; });
  }
  function bothArms(pose) { setPose('L', pose); setPose('R', pose); }
  function planArms() {
    if (t < armPlan.next || grab || mood.state !== 'awake' || t < mood.flail || t < vibe.until) return;
    var sulky = TEMPER.name === 'grumpy' || TEMPER.name === 'mad' || TEMPER.name === 'dismissive';
    var choice = pick([['stay', 38], ['swing', 16], ['crossFront', sulky ? 40 : 15], ['crossBack', 15], ['rub', 16]]);
    var dur = rnd(3.2, 6);
    if (choice === 'stay') { armPlan.next = t + rnd(3, 6); return; }
    if (choice === 'rub') {
      var k = Math.random() < 0.5 ? 'L' : 'R';
      setPose(k, 'rubUp'); later(0.45, function () { if (arms[k].pose === 'rubUp') setPose(k, 'rub'); });
      later(0.45 + dur * 0.7, function () { if (arms[k].pose === 'rub') { setPose(k, 'rubDown'); later(0.4, function () { if (arms[k].pose === 'rubDown') setPose(k, 'down'); }); } });
      headPlan.forceTilt = { side: -SIDE[k], until: t + 0.45 + dur * 0.7 };
    } else {
      bothArms(choice);
      later(dur, function () { ['L', 'R'].forEach(function (k) { if (arms[k].pose === choice) setPose(k, 'down'); }); });
    }
    armPlan.next = t + dur + rnd(4, 9);
  }
  function planHead() {
    if (mood.state === 'asleep') { head.target = mood.sleepSide * 0.13; head.shiftT = 0; head.shiftYT = 12; return; }
    if (mood.state === 'fedUp') { head.target = 0.06 * mood.sleepSide; head.shiftT = 0; head.shiftYT = 3; return; }
    if (t < vibe.until) { head.face = vibe.likes ? 'sleep' : 'fedUp'; head.shiftT = 0; head.shiftYT = 2; return; }
    if (wander.dir) { head.face = wander.dir < 0 ? 'lookLeft' : 'lookRight'; head.target = wander.dir * 0.05; head.shiftT = wander.dir * 5; head.shiftYT = 0; headPlan.next = t + rnd(1, 2); return; }
    if (headPlan.forceTilt && t < headPlan.forceTilt.until) { head.target = headPlan.forceTilt.side * 0.07; head.face = 'main'; head.shiftT = 0; head.shiftYT = 0; return; }
    if (t < headPlan.next) return;
    var tm = TEMPER.name;
    var away = tm === 'dismissive' ? 30 : 13;
    var c = pick([['still', 50], ['lookLeft', away], ['lookRight', away], ['lookDown', tm === 'sad' ? 45 : 12], ['tilt', 12],
                  ['glad', tm === 'kind' || tm === 'delighted' ? 22 : 0]]);
    head.shiftT = 0; head.shiftYT = 0;
    if (c === 'still') { head.target = rnd(-0.015, 0.015); head.face = 'main'; headPlan.next = t + rnd(3, 7); }
    else if (c === 'lookLeft') { head.face = 'lookLeft'; head.target = -rnd(0.07, 0.12); head.shiftT = -6; headPlan.next = t + rnd(1.6, 3.4); }
    else if (c === 'lookRight') { head.face = 'lookRight'; head.target = rnd(0.07, 0.12); head.shiftT = 6; headPlan.next = t + rnd(1.6, 3.4); }
    else if (c === 'lookDown') { head.face = 'lookDown'; head.target = Math.random() < 0.5 ? rnd(-0.06, 0.06) : 0; head.shiftYT = 9; headPlan.next = t + rnd(2, 4.5); }
    else if (c === 'glad') { head.face = Math.random() < 0.5 ? 'content' : 'happy'; head.target = rnd(-0.05, 0.05); headPlan.next = t + rnd(2, 3.5); }
    else { head.face = 'main'; head.target = (Math.random() < 0.5 ? -1 : 1) * rnd(0.08, 0.14); headPlan.next = t + rnd(2, 4); }
  }
  function planLean() {
    if (mood.state !== 'awake') { lean = 0; return; }
    if (t < leanPlan.next) return;
    lean = pick([[0, 50], [0.045, 12], [-0.045, 12], [0.075, 8], [-0.075, 8]]);
    leanPlan.next = t + rnd(4, 9);
  }
  function planWander() {
    // she drifts slowly around the garden now and then, leaning and looking where she goes
    if (wander.goal) return;
    if (mood.state !== 'awake' || grab || t < vibe.until || PLACE.busy) { wander.target = wander.x; return; }
    if (t < wander.next) return;
    var r = wanderRange(), far = TEMPER.name === 'sad' ? 250 : TEMPER.name === 'kind' || TEMPER.name === 'delighted' ? 900 : 650;
    wander.target = Math.random() < 0.25 ? wander.x : clamp(wander.x + rnd(-far, far), r[0], r[1]);
    wander.next = t + rnd(9, 20);
  }

  // ---------- faces, moods, reactions ----------
  var WORDS = { poke: ['つん', 'ぷに', 'ぽよ'], annoyed: ['ムッ'], gloom: ['ずーん'], relief: ['ふぅ…'], grab: ['!?', 'ひゃ'],
                wake: ['はっ!', '!?'], refuse: ['やだ!', 'もう!'], zzz: ['Zzz', 'すぴー', 'くー'], note: ['♪', '♫', 'ふんふん'], dizzy: ['@_@', 'ぐるぐる'], giggle: ['えへ', 'ふふっ', 'くすっ'] };
  function word(list, at, opt) { fx.push({ kind: 'word', text: oneOf(list), x: at.x, y: at.y, t0: t, dur: (opt && opt.dur) || 1.15, tilt: rnd(-0.16, 0.16), size: (opt && opt.size) || 72, drift: (opt && opt.drift) || 0 }); }
  function mark(kind, dur) { fx.push({ kind: kind, t0: t, dur: dur, side: Math.random() < 0.5 ? -1 : 1 }); }
  function showFace(name, sec) { react = { face: name, until: t + sec }; }
  function heldWild() { return grab && (Math.abs(wrap(body.a)) > 1.5 || Math.abs(body.va) > 3.2); }
  function faceName() {
    if (t < mood.flail) return 'boop';
    if (mood.state === 'fedUp') return 'fedUp';
    if (heldWild()) return 'boop';
    if (react && t < react.until) return react.face;
    if (mood.state === 'asleep') return 'sleep';
    return head.face;
  }
  function setMood(state, seconds) {
    var was = mood.state; mood.state = state; mood.until = seconds ? t + seconds : 0;
    if (state === 'fedUp') {
      var top = headPt(V(660, 40)); mark('gloom', 2.6); word(WORDS.gloom, V(top.x + 150, top.y + 60));
      bothArms('crossFront'); mood.upset = 0; emit('fedUp');
    } else if (state === 'awake' && was === 'fedUp') {
      var p = headPt(V(800, 120)); mark('relief', 1.8); word(WORDS.relief, V(p.x + 60, p.y)); bothArms('down'); armPlan.next = t + 3; emit('calmed');
    } else if (state === 'asleep') { bothArms('sleep'); mood.nextZ = t + 1; emit('slept'); }
    else if (state === 'awake' && was === 'asleep') { bothArms('down'); armPlan.next = t + 4; }
    emit('mood', { state: state });
  }
  var wokeAt = -10;
  function wakeUp() {
    wokeAt = t; setMood('awake'); showFace('surprised', 1.3); mark('bang', 1.1);
    var p = headPt(V(820, 60)); word(WORDS.wake, V(p.x + 40, p.y)); body.sqv += 1.2; mood.lastTouch = t;
    emit('woke');
  }
  function refuse(at) {
    mood.flail = t + 0.9; bothArms('flail');
    later(0.9, function () { if (mood.state === 'fedUp') bothArms('crossFront'); else bothArms('down'); });
    var away = at.x < bodyPt(COM).x ? 1 : -1;
    body.vx += away * 260; body.va += away * 2.2; cam.shake = 0.4;
    mark('vein', 1.2); word(WORDS.refuse, V(at.x, at.y - 90));
    if (mood.state === 'fedUp') mood.until += 1;
    emit('refused');
  }
  function touchStart() {
    if (mood.state === 'fedUp') return false;
    if (mood.state === 'asleep') { wakeUp(); return true; }
    showFace('boop', 0.85); mood.lastTouch = t;
    return true;
  }
  function boop(at) {
    if (mood.state !== 'awake' || t - wokeAt < 0.8) return;
    showFace('boop', 0.85); mood.lastTouch = t;
    mood.boops = mood.boops.filter(function (x) { return t - x < 4; }); mood.boops.push(t);
    var n = mood.boops.length, limit = { kind: 9, delighted: 10, calm: 6, sad: 5, dismissive: 4, grumpy: 3 }[TEMPER.name] || 6;
    var rapid = mood.boops.length >= 3 && t - mood.boops[mood.boops.length - 3] < 1.6;
    var tilt = at.x < bodyPt(COM).x ? 1 : -1;
    head.v += tilt * 1.6; body.vx += -tilt * 40; body.sqv += 0.9;
    emit('boop', { n: n, rapid: rapid, limit: limit });
    var soft = TEMPER.name === 'kind' || TEMPER.name === 'delighted';
    if (n >= limit) { mood.boops = []; setMood('fedUp', rnd(FEDUP_FOR[0], FEDUP_FOR[1]) + (TEMPER.name === 'grumpy' ? 2 : 0)); }
    else if (n >= Math.max(2, Math.ceil(limit * 0.55))) {
      if (soft) { mark('sweat', 1.4); word(WORDS.giggle, V(at.x + 40, at.y - 90)); }
      else { mark('vein', 1.6); word(WORDS.annoyed, V(at.x + 40, at.y - 90)); mood.upset = 1; mood.reliefAt = t + 3.5; }
    }
    else if (TEMPER.name === 'grumpy') { mark('vein', 1.2); word(WORDS.annoyed, V(at.x + 30, at.y - 80)); }
    else { mark(soft ? 'sparkle' : pick([['sweat', 3], ['bang', 3], ['sparkle', 2]]), 1.3); word(soft ? WORDS.giggle : WORDS.poke, V(at.x + 30, at.y - 80)); }
  }
  // things her brain can ask her body to do
  function act(name) {
    if (name === 'flail') { mood.flail = t + 0.9; bothArms('flail'); later(0.9, function () { bothArms('down'); }); cam.shake = 0.3; }
    else if (name === 'vibe' || name === 'hate_music') {
      vibe.until = t + (name === 'vibe' ? 14 : 3); vibe.likes = name === 'vibe';
      if (name === 'vibe') bothArms('vibe'); else { mood.flail = t + 0.9; bothArms('flail'); mark('vein', 1.4); }
      later(name === 'vibe' ? 14 : 1, function () { if (arms.L.pose === 'vibe' || arms.L.pose === 'flail') bothArms('down'); });
    }
    else if (name === 'sulk') { bothArms('crossFront'); later(6, function () { if (arms.L.pose === 'crossFront') bothArms('down'); }); }
    else if (name === 'sparkle') { mark('sparkle', 1.6); }
    else if (name === 'gloom') { mark('gloom', 2.4); }
    else if (name === 'happy') { showFace('happy', 2.2); mark('sparkle', 1.6); body.sqv += 1; }
    else if (name === 'sweat') { mark('sweat', 1.4); }
  }
  function moodTick() {
    if (mood.state === 'fedUp' && mood.until && t > mood.until && !grab) setMood('awake');
    if (mood.state === 'awake' && mood.upset && t > mood.reliefAt && !grab) {
      mood.upset = 0; mark('relief', 1.8);
      var top = headPt(V(800, 120)); word(WORDS.relief, V(top.x + 60, top.y));
    }
    if (mood.state === 'awake' && !grab && t - mood.lastTouch > SLEEP_AFTER && t > mood.flail && t > vibe.until && !UIBUSY()) setMood('asleep');
    if (mood.state === 'asleep' && t > mood.nextZ) {
      var p = headPt(V(mood.sleepSide > 0 ? 830 : 500, 60));
      word(WORDS.zzz, V(p.x + mood.sleepSide * 40, p.y), { size: 46, dur: 2.4, drift: mood.sleepSide * 60 });
      mood.nextZ = t + rnd(2.2, 3.2);
    }
    if (t < vibe.until && vibe.likes && t > vibe.nextNote) {
      var q = headPt(V(Math.random() < 0.5 ? 470 : 840, 80)); word(WORDS.note, q, { size: 50, dur: 1.6, drift: rnd(-40, 40) });
      vibe.nextNote = t + rnd(0.8, 1.4);
    }
    fx = fx.filter(function (f) { return t - f.t0 < f.dur; });
    if (react && t > react.until) react = null;
  }
  var UIBUSY = function () { return false; };                    // the chat sets this while you type

  // ---------- physics ----------
  function spring(o, key, vel, target, k, damp, extra, dt) {
    var diff = wrap(target - o[key]);
    o[vel] += (k * diff - damp * o[vel] + (extra || 0)) * dt;
    o[key] += o[vel] * dt;
  }
  function solveArmIK(k, T, d) {
    var A = ARM[k], S = shoulderW(k), l1 = A.l1, l2 = d, cur = arms[k];
    var dx = T.x - S.x, dy = T.y - S.y, dist = Math.hypot(dx, dy);
    var D = clamp(dist, Math.abs(l1 - l2) + 1, l1 + l2 - 0.5);
    var cosA = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1);
    var base = dirA(V(dx, dy)), alpha = Math.acos(cosA);
    var e1 = base - alpha, e2 = base + alpha;
    var e = Math.abs(wrap(e1 - cur.e)) <= Math.abs(wrap(e2 - cur.e)) ? e1 : e2;  // keep the elbow bending the way it already does
    var E = V(S.x + Math.sin(e) * l1, S.y + Math.cos(e) * l1);
    return { e: e, bend: wrap(dirA(V(T.x - E.x, T.y - E.y)) - e) };
  }
  function step(dt) {
    t += dt;
    for (var i = 0; i < timers.length; i++) if (timers[i].at <= t) { var tm = timers.splice(i, 1)[0]; i--; tm.fn(); }
    planArms(); planHead(); planLean(); planWander(); moodTick();

    var asleep = mood.state === 'asleep', sad = TEMPER.name === 'sad';
    var bob = reduceMotion ? 0 : asleep ? -4 + Math.sin(t * 0.7) * 5 : -10 + Math.sin(t * (sad ? 0.9 : 1.25)) * (sad ? 6 : 9);
    var sway = reduceMotion ? 0 : Math.sin(t * 0.8) * (asleep ? 0.02 : 0.012);

    // wandering: a slow walk-like drift
    if (wander.goal) wander.target = wander.goal.x;
    var wdx = wander.target - wander.x, wsp = (wander.goal ? 280 : 40) * dt;
    wander.x += clamp(wdx, -wsp, wsp);
    wander.dir = Math.abs(wdx) > 6 && !grab ? Math.sign(wdx) : 0;
    if (wander.goal && Math.abs(wander.goal.x - wander.x) < 4 && Math.abs(body.x - wander.x) < 30) { var gcb = wander.goal.cb; wander.goal = null; if (gcb) gcb(); }
    if (grab) wander.goal = null;
    // the camera follows her along the garden unless you're looking around
    var cs = view.k * cam.s, bnd = SCENE.bounds(PLACE.name);
    if (!pan && !pinch && !grab && t > cam.free) cam.x += (-body.x * cs - cam.x) * Math.min(1, dt * 1.6);
    var half = view.w / 2 / cs, fx = 660 - cam.x / cs, fxc = bnd[1] - bnd[0] < half * 2 ? (bnd[0] + bnd[1]) / 2 : clamp(fx, bnd[0] + half, bnd[1] - half);
    cam.x = -(fxc - 660) * cs;

    if (grab) {
      var fv = finger.last ? V((grab.tx - finger.last.x) / dt, (grab.ty - finger.last.y) / dt) : V(0, 0);
      finger.a = V(finger.a.x * 0.75 + 0.25 * (fv.x - finger.v.x) / dt, finger.a.y * 0.75 + 0.25 * (fv.y - finger.v.y) / dt);
      finger.v = fv; finger.last = V(grab.tx, grab.ty);
      mood.lastTouch = t; body.sq = 0; body.sqv = 0;
    }

    if (grab && grab.type === 'body') {
      var tx = grab.tx - grab.ox, ty = grab.ty - grab.oy;
      body.vx += (260 * (tx - body.x) - 2 * Math.sqrt(260) * 0.9 * body.vx) * dt;
      body.vy += (260 * (ty - body.y) - 2 * Math.sqrt(260) * 0.9 * body.vy) * dt;
      body.x += body.vx * dt; body.y += body.vy * dt;
      spring(body, 'a', 'va', clamp(body.vx * 0.00045 * grab.lever, -0.45, 0.45), 60, 2 * Math.sqrt(60) * 0.6, 0, dt);
      wander.x = wander.target = body.x;
    } else if (grab && grab.type === 'leg') {
      // she hangs from your finger by the leg and swings with gravity and your movements
      var Pl = grab.local, r = rot(V(COM.x - Pl.x, COM.y - Pl.y), body.a);
      var gx = -clamp(finger.a.x, -30000, 30000) * 0.9, gy = 5200 - clamp(finger.a.y, -30000, 30000) * 0.9;
      var torque = r.x * gy - r.y * gx, inertia = r.x * r.x + r.y * r.y + 20000;
      if (Math.abs(body.va) < 0.05 && Math.abs(r.x) < 4 && r.y < 0) body.va += 0.3;
      body.va += (torque / inertia - 1.1 * body.va) * dt;
      var da0 = body.va * dt; grab.turned += da0; body.a = wrap(body.a + da0);
      var off = rot(V(Pl.x - WAIST.x, Pl.y - WAIST.y), body.a);
      var nx = grab.tx - WAIST.x - off.x, ny = grab.ty - WAIST.y - off.y;
      body.vx = (nx - body.x) / dt; body.vy = (ny - body.y) / dt; body.x = nx; body.y = ny;
      wander.x = wander.target = body.x;
    } else if (grab && grab.type === 'arm') {
      // held by the hand she keeps floating; pulled past full reach, the arm goes straight and drags her along
      body.vx += (6 * (wander.x - body.x) - 1.8 * body.vx) * dt;
      body.vy += (6 * (bob - body.y) - 1.8 * body.vy) * dt;
      body.x += body.vx * dt; body.y += body.vy * dt;
      spring(body, 'a', 'va', 0, 12, 2 * Math.sqrt(12) * 0.7, 0, dt);
      var k = grab.side, reach = ARM[k].l1 + grab.d, T = V(grab.tx, grab.ty);
      for (var it = 0; it < 2; it++) {
        var S = shoulderW(k), dx = T.x - S.x, dy = T.y - S.y, L = Math.hypot(dx, dy);
        if (L > reach) {
          var cx = dx * (1 - reach / L), cy = dy * (1 - reach / L);
          var R = V(S.x - (WAIST.x + body.x), S.y - (WAIST.y + body.y)), R2 = R.x * R.x + R.y * R.y;
          var da = 0.3 * (R.x * cy - R.y * cx) / R2;
          body.a = clamp(body.a + da, -0.6, 0.6); body.va += da / dt * 0.2;
          S = shoulderW(k); dx = T.x - S.x; dy = T.y - S.y; L = Math.hypot(dx, dy);
          if (L > reach) { var mx = dx * (1 - reach / L), my = dy * (1 - reach / L); body.x += mx; body.y += my; body.vx += mx / dt * 0.35; body.vy += my / dt * 0.35; }
        }
      }
      var wr = wanderRange(); wander.x = wander.target = clamp(body.x, wr[0], wr[1]);
      // shoulder follows freely; only the elbow has a fold limit, and it slows as it gets close
      var ik = solveArmIK(k, T, grab.d), a = arms[k];
      var ne = a.e + wrap(ik.e - a.e) * Math.min(1, dt * 30);
      var curBend = wrap(a.f - a.e), want = clamp(ik.bend, -BEND_MAX, BEND_MAX);
      var near = clamp((Math.abs(curBend) - BEND_SOFT) / (BEND_MAX - BEND_SOFT), 0, 1);
      var folding = Math.abs(want) > Math.abs(curBend);
      var nb = curBend + (want - curBend) * Math.min(1, dt * 24 * (folding ? 1 - 0.9 * near : 1));
      nb = clamp(nb, -BEND_MAX, BEND_MAX);
      a.ev = wrap(ne - a.e) / dt * 0.3; a.fv = 0; a.e = ne; a.f = ne + nb;
    } else {
      var shakeX = t < mood.flail ? Math.sin(t * 46) * 900 : 0;
      body.vx += (14 * (wander.x - body.x) - 2 * Math.sqrt(14) * 0.85 * body.vx + shakeX) * dt;
      body.vy += (14 * (bob - body.y) - 2 * Math.sqrt(14) * 0.85 * body.vy) * dt;
      body.x += body.vx * dt; body.y += body.vy * dt;
      var walkLean = wander.dir * 0.06, vibeSway = t < vibe.until && vibe.likes ? Math.sin(t * 2 * Math.PI * 0.95) * 0.06 : 0;
      spring(body, 'a', 'va', lean + sway + walkLean + vibeSway + (t < mood.flail ? Math.sin(t * 30) * 0.08 : 0), 22, 2 * Math.sqrt(22) * 0.75, 0, dt);
      body.a = wrap(body.a);
    }
    body.sqv += (-220 * body.sq - 9 * body.sqv) * dt; body.sq += body.sqv * dt;

    ['L', 'R'].forEach(function (k) {
      var S = shoulderW(k);
      if (prevShoulder[k]) {
        var v = V((S.x - prevShoulder[k].x) / dt, (S.y - prevShoulder[k].y) / dt);
        shoulderAcc[k] = V(shoulderAcc[k].x * 0.7 + 0.3 * (v.x - prevShoulderV[k].x) / dt, shoulderAcc[k].y * 0.7 + 0.3 * (v.y - prevShoulderV[k].y) / dt);
        prevShoulderV[k] = v;
      }
      prevShoulder[k] = S;
    });
    var Wp = bodyPt(WAIST);
    if (prevWaist) {
      var wv = V((Wp.x - prevWaist.x) / dt, (Wp.y - prevWaist.y) / dt);
      waistAcc = V(waistAcc.x * 0.7 + 0.3 * (wv.x - prevWaistV.x) / dt, waistAcc.y * 0.7 + 0.3 * (wv.y - prevWaistV.y) / dt);
      prevWaistV = wv;
    }
    prevWaist = Wp;

    var flip = clamp((Math.abs(wrap(body.a)) - 0.5) / 1.3, 0, 1);
    ['L', 'R'].forEach(function (k) {
      if (grab && grab.type === 'arm' && grab.side === k) return;
      var a = arms[k], o = POSES[a.pose](k, t), s = SIDE[k];
      var eT = s * o[0] * D2R - body.a, fT = s * o[1] * D2R - body.a;
      if (flip > 0) { eT += wrap(s * 0.15 - eT) * flip * 0.9; fT += wrap(s * 0.1 - fT) * flip * 0.9; }
      var ax = clamp(shoulderAcc[k].x, -14000, 14000), ay = clamp(shoulderAcc[k].y, -14000, 14000);
      var stiff = a.pose === 'flail' ? 260 : a.pose === 'swing' || a.pose === 'vibe' ? 80 : flip > 0.3 ? 45 : 110;
      spring(a, 'e', 'ev', eT, stiff, 2 * Math.sqrt(stiff) * 0.55, (-ax * Math.cos(a.e) + ay * Math.sin(a.e)) * 0.0045, dt);
      spring(a, 'f', 'fv', fT, stiff * 0.85, 2 * Math.sqrt(stiff) * 0.5, (-ax * Math.cos(a.f) + ay * Math.sin(a.f)) * 0.006, dt);
    });

    var hx = clamp(waistAcc.x, -9000, 9000), ba = wrap(body.a);
    var bobHead = t < vibe.until && vibe.likes ? Math.sin(t * 2 * Math.PI * 1.9) * 0.09 : 0;
    spring(head, 'r', 'v', head.target + bobHead, t < vibe.until ? 90 : 28, 2 * Math.sqrt(28) * 0.8, -hx * 0.00025, dt);
    head.shift += (head.shiftT - head.shift) * Math.min(1, dt * 6);
    head.shiftY += (head.shiftYT - head.shiftY) * Math.min(1, dt * (asleep ? 1.5 : 5));
    // hair hangs toward the ground: barely moves when she's upright, swings all the way round when she's upside down
    var A = wrap(body.a + head.r);
    var wgt = 0.25 + 0.75 * clamp((Math.abs(A) - 0.25) / 1.1, 0, 1);
    var idleHair = reduceMotion ? 0 : Math.sin(t * 0.7 + 1) * 0.014;
    spring(hair, 'r', 'v', -A * wgt + idleHair, 26, 2 * Math.sqrt(26) * 0.35, -hx * 0.0004, dt);
    var idleRobe = reduceMotion ? 0 : Math.sin(t * 0.9 + 0.4) * 0.016;
    spring(skirt, 'r', 'v', clamp(-ba * 0.35, -0.3, 0.3) + idleRobe, 34, 2 * Math.sqrt(34) * 0.35, -hx * 0.0005, dt);
    spring(legs, 'r', 'v', clamp(-(ba + skirt.r) * 0.3, -0.3, 0.3) + idleRobe * 0.6, 40, 2 * Math.sqrt(40) * 0.3, -hx * 0.0006, dt);
    cam.shake = Math.max(0, cam.shake - dt);
  }

  // ---------- anime marks and sound words ----------
  function star4(x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
  }
  function drawMarks() {
    fx.forEach(function (f) {
      if (f.kind === 'word') return;
      var u = (t - f.t0) / f.dur, al = Math.min(ease(u / 0.15), 1 - ease((u - 0.75) / 0.25));
      ctx.save(); ctx.globalAlpha = al;
      if (f.kind === 'vein') {
        ctx.translate(f.side > 0 ? 800 : 520, 110);
        var pz = (1 + 0.14 * Math.sin((t - f.t0) * 18) * (1 - u)) * ease(u / 0.12);
        ctx.scale(pz, pz); ctx.strokeStyle = '#d0142f'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        for (var q = 0; q < 4; q++) { ctx.save(); ctx.rotate(q * Math.PI / 2); ctx.beginPath(); ctx.moveTo(8, -34); ctx.quadraticCurveTo(10, -10, 34, -8); ctx.stroke(); ctx.restore(); }
      } else if (f.kind === 'sweat' || f.kind === 'relief') {
        var x = f.side > 0 ? 845 : 470, y = 150 + 40 * ease(u);
        ctx.translate(x, y); ctx.rotate(f.side * -0.25);
        ctx.beginPath(); ctx.moveTo(0, -34); ctx.bezierCurveTo(14, -12, 22, 2, 22, 14); ctx.arc(0, 14, 22, 0, Math.PI); ctx.bezierCurveTo(-22, 2, -14, -12, 0, -34); ctx.closePath();
        ctx.fillStyle = '#a9d8f2'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#2f5f7c'; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(-8, 10, 5, 9, 0.3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      } else if (f.kind === 'gloom') {
        for (var g = 0; g < 9; g++) {
          var gx = 500 + g * 38, len = 120 + (g % 3) * 40, gy = 30 + (g % 2) * 14;
          var lg = ctx.createLinearGradient(0, gy, 0, gy + len);
          lg.addColorStop(0, 'rgba(92,70,160,0.75)'); lg.addColorStop(1, 'rgba(92,110,200,0)');
          ctx.fillStyle = lg; ctx.fillRect(gx, gy + 8 * Math.sin(t * 3 + g), 9, len);
        }
      } else if (f.kind === 'bang') {
        ctx.translate(f.side > 0 ? 830 : 490, 60); ctx.scale(f.side, 1);
        var kk = ease(u / 0.12) * (1 + 0.1 * Math.sin((t - f.t0) * 20) * (1 - u));
        ctx.scale(kk, kk); ctx.strokeStyle = '#161418'; ctx.lineWidth = 8; ctx.lineCap = 'round';
        [[-0.5, 40], [0.1, 52], [0.7, 40]].forEach(function (l) { ctx.beginPath(); ctx.moveTo(Math.sin(l[0]) * 14, -Math.cos(l[0]) * 14); ctx.lineTo(Math.sin(l[0]) * l[1], -Math.cos(l[0]) * l[1]); ctx.stroke(); });
      } else if (f.kind === 'sparkle') {
        [[840, 70, 26], [880, 150, 16], [470, 90, 18]].forEach(function (p, j) { star4(p[0], p[1], p[2] * (0.6 + 0.4 * Math.sin((t - f.t0) * 9 + j * 2)) * ease(u / 0.2), '#e7b93f'); });
      }
      ctx.restore();
    });
  }
  function drawWords() {
    fx.forEach(function (f) {
      if (f.kind !== 'word') return;
      var u = (t - f.t0) / f.dur, pop = u < 0.12 ? 0.6 + 0.55 * ease(u / 0.12) : 1.15 - 0.15 * ease((u - 0.12) / 0.15);
      ctx.save(); ctx.globalAlpha = 1 - ease((u - 0.7) / 0.3);
      ctx.translate(f.x + f.drift * ease(u), f.y - 40 * ease(u) - (f.size < 60 ? 60 * u : 0)); ctx.rotate(f.tilt); ctx.scale(pop, pop);
      ctx.font = f.size + 'px "Mochiy Pop One", "M PLUS Rounded 1c", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = f.size * 0.22; ctx.strokeStyle = '#161418'; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    });
  }

  // ---------- drawing her ----------
  var M = {};
  function sprite(name, x, y) { ctx.drawImage(IMG[name], x, y); M[name] = ctx.getTransform().inverse(); M[name].ox = x; M[name].oy = y; }
  function withBody(fn) { ctx.save(); ctx.translate(WAIST.x + body.x, WAIST.y + body.y); ctx.rotate(body.a); ctx.scale(1 + body.sq * 0.6, 1 - body.sq); ctx.translate(-WAIST.x, -WAIST.y); fn(); ctx.restore(); }
  function withHead(fn) { withBody(function () { ctx.translate(NECK.x + head.shift, NECK.y + head.shiftY); ctx.rotate(head.r); ctx.translate(-NECK.x, -NECK.y); fn(); }); }
  function drawUpper(k) { var A = ARM[k], a = arms[k], S = shoulderW(k); ctx.save(); ctx.translate(S.x, S.y); ctx.rotate(A.eA0 - a.e); sprite('upper_' + k, -A.up.pivot[0], -A.up.pivot[1]); ctx.restore(); }
  function drawFore(k) { var A = ARM[k], a = arms[k], E = elbowW(k); ctx.save(); ctx.translate(E.x, E.y); ctx.rotate(A.fA0 - a.f); sprite('fore_' + k, -A.fo.pivot[0], -A.fo.pivot[1]); ctx.restore(); }
  function worldTransform() { var s = view.k * cam.s; ctx.translate(view.w / 2 + cam.x, view.h * ANCHOR + cam.y); ctx.scale(s, s); ctx.translate(-CENTER.x, -CENTER.y); }
  function drawHer() {
    var P = RIG.parts;
    var lift = clamp(-body.y, -60, 260), sc = 1 - lift * 0.0016;
    ctx.save(); ctx.translate(662 + body.x * 0.9, GROUND); ctx.scale(sc, 1);
    var g = ctx.createRadialGradient(0, 0, 10, 0, 0, 150);
    g.addColorStop(0, 'rgba(20,25,30,' + (0.3 * sc).toFixed(3) + ')'); g.addColorStop(1, 'rgba(20,25,30,0)');
    ctx.beginPath(); ctx.ellipse(0, 0, 150, 18, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
    withHead(function () { ctx.translate(HAIR_PIVOT.x, HAIR_PIVOT.y); ctx.rotate(hair.r); ctx.translate(-HAIR_PIVOT.x, -HAIR_PIVOT.y); sprite('hairback', P.hairback.x, P.hairback.y); });
    ['R', 'L'].forEach(function (k) { drawUpper(k); if (arms[k].z === 'back') drawFore(k); });
    withBody(function () {
      ctx.save();
      ctx.translate(SKIRT.x, SKIRT.y); ctx.rotate(skirt.r); ctx.translate(-SKIRT.x, -SKIRT.y);
      ctx.save(); ctx.translate(LEGS.x, LEGS.y); ctx.rotate(legs.r); ctx.translate(-LEGS.x, -LEGS.y); sprite('legs', P.legs.x, P.legs.y); ctx.restore();
      sprite('skirt', P.skirt.x, P.skirt.y);
      ctx.restore();
      sprite('dress', P.dress.x, P.dress.y);
    });
    ['R', 'L'].forEach(function (k) { if (arms[k].z === 'front') drawFore(k); });
    var fnm = faceName(), F = RIG.faces[fnm] || RIG.faces.main;
    withHead(function () { sprite('face_' + fnm, F.x, F.y); });
  }

  // ---------- hit testing ----------
  function alphaAt(name, sx, sy) {
    var m = M[name]; if (!m) return 0;
    var p = m.transformPoint(new DOMPoint(sx * view.dpr, sy * view.dpr));
    var x = Math.round(p.x - m.ox), y = Math.round(p.y - m.oy), al = ALPHA[name];
    if (!al || x < 0 || y < 0 || x >= al.w || y >= al.h) return 0;
    return al.data[(y * al.w + x) * 4 + 3];
  }
  function segDist(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    var u = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1);
    return { d: Math.hypot(p.x - (a.x + u * vx), p.y - (a.y + u * vy)), u: u };
  }
  function hitArm(sx, sy, front) {
    var p = toWorld(sx, sy), best = null, slop = 30 / (view.k * cam.s) * 0.6 + 18;
    ['L', 'R'].forEach(function (k) {
      if ((arms[k].z === 'front') !== front) return;
      var S = shoulderW(k), E = elbowW(k), H = handW(k);
      var fo = segDist(p, E, H), up = segDist(p, S, E);
      var onFore = alphaAt('fore_' + k, sx, sy) > 30 || fo.d < slop;
      var onUp = !front && (alphaAt('upper_' + k, sx, sy) > 30 || up.d < slop * 0.8);
      if (onFore && (!best || fo.d < best.dist)) best = { side: k, d: clamp(fo.u * ARM[k].l2, 40, ARM[k].l2), dist: fo.d };
      else if (onUp && (!best || up.d < best.dist)) best = { side: k, d: 40, dist: up.d };
    });
    return best;
  }
  function onSprite(names, sx, sy) { return names.some(function (n) { return alphaAt(n, sx, sy) > 30; }); }

  // ---------- touch, mouse, zoom ----------
  var pointers = new Map(), pinch = null, pan = null, lastTap = 0, press = null;
  function pt(e) { var r = cv.getBoundingClientRect(); return V(e.clientX - r.left, e.clientY - r.top); }
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId);
    var p = pt(e); pointers.set(e.pointerId, p); emit('touch');
    if (pointers.size === 2) {
      grab = null; pan = null; press = null; cv.classList.remove('grabbing');
      var ps = Array.from(pointers.values()), mid = V((ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
      pinch = { d0: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), s0: cam.s, world: toWorld(mid.x, mid.y) };
      return;
    }
    if (pointers.size > 2) return;
    var w = toWorld(p.x, p.y), face = 'face_' + faceName();
    var arm = hitArm(p.x, p.y, true);
    if (!arm && !onSprite([face, 'dress'], p.x, p.y)) arm = hitArm(p.x, p.y, false);
    var onLegs = !arm && !onSprite([face, 'dress', 'skirt'], p.x, p.y) && onSprite(['legs'], p.x, p.y);
    var onBody = !arm && !onLegs && onSprite([face, 'dress', 'skirt', 'legs', 'hairback'], p.x, p.y);
    finger.last = null; finger.v = V(0, 0); finger.a = V(0, 0);
    if ((arm || onLegs || onBody) && !touchStart()) { refuse(w); return; }
    if (arm) {
      grab = { type: 'arm', side: arm.side, d: arm.d, tx: w.x, ty: w.y };
      if (arms[arm.side].pose !== 'down') setPose(arm.side, 'down');
    } else if (onLegs) {
      grab = { type: 'leg', tx: w.x, ty: w.y, local: bodyLocal(w), turned: 0, upside: false };
      ['L', 'R'].forEach(function (k) { if (arms[k].pose !== 'down') setPose(k, 'down'); });
    } else if (onBody) {
      var wp = bodyPt(WAIST);
      grab = { type: 'body', tx: w.x, ty: w.y, ox: w.x - body.x, oy: w.y - body.y, lever: w.y < wp.y ? 1 : -1 };
    } else {
      var now = Date.now();
      if (now - lastTap < 320) { cam.s = 1; cam.y = 0; cam.free = 0; }
      lastTap = now;
      pan = { x: p.x, y: p.y, cx: cam.x, cy: cam.y };
    }
    if (grab) {
      cv.classList.add('grabbing');
      press = { x: p.x, y: p.y, at: Date.now(), world: w, type: grab.type, moved: false };
      emit('grab', { type: grab.type });
      if (grab.type === 'leg') later(0.25, function () { if (grab && grab.type === 'leg' && press && press.moved) { mark('bang', 1.1); word(WORDS.grab, headPt(V(820, 60))); } });
    }
  });
  cv.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    var p = pt(e); pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      var ps = Array.from(pointers.values());
      var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mid = V((ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
      cam.s = clamp(pinch.s0 * d / pinch.d0, 0.5, 4); keepUnder(pinch.world, mid); cam.free = t + 8;
      return;
    }
    if (press && Math.hypot(p.x - press.x, p.y - press.y) > 9) press.moved = true;
    if (grab) { var w = toWorld(p.x, p.y); grab.tx = w.x; grab.ty = w.y; if (grab.type === 'leg' && Math.abs(wrap(body.a)) > 2.4 && !grab.upside) { grab.upside = true; emit('upside'); } }
    else if (pan) { cam.x = pan.cx + (p.x - pan.x); cam.y = clamp(pan.cy + (p.y - pan.y), -view.h * 0.6, view.h * 0.6); cam.free = t + 8; }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      var wasBoop = press && !press.moved && Date.now() - press.at < 280, at = press && press.world;
      if (grab && grab.type === 'leg' && Math.abs(grab.turned) > Math.PI * 2) {
        var turns = Math.abs(grab.turned) / (Math.PI * 2);
        emit('spun', { turns: turns }); var hp = headPt(V(820, 60)); word(WORDS.dizzy, V(hp.x + 30, hp.y)); showFace('boop', 1.6);
      }
      grab = null; pan = null; press = null; cv.classList.remove('grabbing');
      if (wasBoop) boop(at);
    }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  function keepUnder(world, screen) {
    var s = view.k * cam.s;
    cam.x = screen.x - view.w / 2 - (world.x - CENTER.x) * s;
    cam.y = screen.y - view.h * ANCHOR - (world.y - CENTER.y) * s;
  }
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = pt(e), w = toWorld(p.x, p.y);
    cam.s = clamp(cam.s * Math.exp(-e.deltaY * 0.0015), 0.5, 4); keepUnder(w, p); cam.free = t + 8;
  }, { passive: false });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- one frame ----------
  function resize() {
    var w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view = { w: w, h: h, dpr: dpr, k: Math.min(h * 0.58 / CHAR_H, w * 0.8 / CHAR_W) };
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  function draw() {
    var dpr = view.dpr, shx = 0, shy = 0;
    if (cam.shake > 0) { shx = rnd(-1, 1) * 7 * cam.shake / 0.4; shy = rnd(-1, 1) * 5 * cam.shake / 0.4; }
    var cs = view.k * cam.s;
    SCENE.draw(ctx, { w: view.w, h: view.h, dpr: dpr, k: view.k, camS: cam.s, camX: cam.x, camY: cam.y, shx: shx, shy: shy, t: t, reduce: reduceMotion,
                      place: PLACE.name, music: t < vibe.until && vibe.likes, focusX: -cam.x / cs, anchor: ANCHOR },
      function () { ctx.setTransform(dpr, 0, 0, dpr, shx * dpr, shy * dpr); ctx.save(); worldTransform(); drawHer(); ctx.restore(); });
    ctx.setTransform(dpr, 0, 0, dpr, shx * dpr, shy * dpr);
    drawNameTag();
    ctx.save(); worldTransform(); withHead(drawMarks); drawWords(); ctx.restore();
    if (PLACE.fade > 0.003) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,248,236,' + PLACE.fade.toFixed(3) + ')'; ctx.fillRect(0, 0, view.w, view.h); }
  }
  // a small doodled name plate on the ground under her
  function drawNameTag() {
    var p = worldToScreen(V(662 + body.x * 0.9, GROUND + 30)), s = clamp(0.8 + (cam.s - 1) * 0.25, 0.7, 1.3);
    ctx.save(); ctx.translate(p.x, p.y + 14 * s); ctx.scale(s, s);
    ctx.font = '700 13px Mali, "M PLUS Rounded 1c", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var tw = ctx.measureText('Pusheen').width + 22;
    ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = SCENE.INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-tw / 2, -12, tw, 24, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = SCENE.INK; ctx.fillText('Pusheen', 0, 1);
    ctx.restore();
  }
  // going in and out of her house: walk to the door, fade, come out on the other side
  function goPlace(name, cb) {
    if (PLACE.name === name || PLACE.busy) { if (cb) cb(false); return; }
    PLACE.busy = true; if (mood.state === 'asleep') setMood('awake');
    var doorOff = SCENE.door() - 660, startFade = function () {
      var t0 = t;
      (function fadeOut() { PLACE.fade = Math.min(1, (t - t0) / 0.6); if (PLACE.fade < 1) return later(0.016, fadeOut);
        PLACE.name = name;
        var off = name === 'house' ? 0 : doorOff;
        body.x = wander.x = wander.target = off; body.vx = 0;
        cam.x = -off * view.k * cam.s; cam.free = 0;
        emit('place', { place: name });
        var t1 = t;
        (function fadeIn() { PLACE.fade = Math.max(0, 1 - (t - t1) / 0.6); if (PLACE.fade > 0) return later(0.016, fadeIn); PLACE.busy = false; wander.next = t + 6; if (cb) cb(true); })();
      })();
    };
    if (name === 'house') { wander.goal = { x: doorOff, cb: startFade }; }
    else startFade();
  }
  // what the rest of the app can ask of her body
  var BODY = {
    on: function (fn) { listeners.push(fn); },
    act: act, showFace: showFace, wake: function () { if (mood.state === 'asleep') wakeUp(); mood.lastTouch = t; },
    nudge: function () { mood.lastTouch = t; },
    setTemper: function (name) { TEMPER.name = name; },
    setSleepAfter: function (sec) { SLEEP_AFTER = sec; },
    setBusy: function (fn) { UIBUSY = fn; },
    get state() { return mood.state; }, get now() { return t; },
    sleep: function () { if (mood.state === 'awake') setMood('asleep'); },
    headTop: function () { return worldToScreen(headPt(V(655, 40))); },
    goPlace: goPlace, get place() { return PLACE.name; }, setPlaceNow: function (n) { PLACE.name = n; var off = n === 'house' ? 0 : wander.x; body.x = wander.x = wander.target = off; },
    get temper() { return TEMPER.name; },
    shake: function (s) { cam.shake = s || 0.3; }
  };
