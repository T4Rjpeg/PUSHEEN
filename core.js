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
  var cam = { s: 1, x: 0, y: 0, yd: 0, shake: 0, free: 0 }, view = { w: 0, h: 0, k: 1, dpr: 1 };
  var PLACE = { name: 'garden', fade: 0, busy: false };
  var prevShoulder = { L: null, R: null }, shoulderAcc = { L: V(0, 0), R: V(0, 0) }, prevShoulderV = { L: V(0, 0), R: V(0, 0) };
  var prevWaistV = V(0, 0), waistAcc = V(0, 0), prevWaist = null;
  var finger = { v: V(0, 0), a: V(0, 0), last: null };
  var react = null, fx = [];
  var wander = { x: 0, target: 0, z: 0, tz: 0, next: 8, dir: 0, goal: null };
  function wanderRange() { var b = SCENE.bounds(PLACE.name); return [b[0] - 660 + 260, b[1] - 660 - 260]; }
  // ---------- the garden is a floor, not a line: z is how far in front of (+) or behind (−) her usual spot her feet stand ----------
  function zRange() { return SCENE.depth ? SCENE.depth(PLACE.name) : [0, 0]; }
  function dScale(z) { return 1 + z / 1500; }
  function herOX() { return 660 + body.x; }
  // her own drawing space (rig, props, marks) ↔ the garden's world space
  function herToWorld(p) { var s = dScale(wander.z), ox = herOX(); return V(ox + (p.x - ox) * s, GROUND + wander.z + (p.y - GROUND) * s); }
  function worldToHer(p) { var s = dScale(wander.z), ox = herOX(); return V(ox + (p.x - ox) / s, GROUND + (p.y - GROUND - wander.z) / s); }
  function herXf() { var s = dScale(wander.z), ox = herOX(); ctx.translate(ox, GROUND + wander.z); ctx.scale(s, s); ctx.translate(-ox, -GROUND); }
  function toHer(sx, sy) { return worldToHer(toWorld(sx, sy)); }
  function freeSpot(x, z) { return !SCENE.blocked || !SCENE.blocked(PLACE.name, 660 + x, GROUND + z); }
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
    flail:  function (k, tt) { var ph = k === 'L' ? 0 : 1.9; return [75 + 50 * Math.sin(tt * 24 + ph), 95 + 70 * Math.sin(tt * 24 + ph + 0.9)]; },
    // poses she can take on purpose
    waveR:  function (k, tt) { return k === 'R' ? [148, 172 + 28 * Math.sin(tt * 11)] : POSES.down(k, tt); },
    waveL:  function (k, tt) { return k === 'L' ? [148, 172 + 28 * Math.sin(tt * 11)] : POSES.down(k, tt); },
    cheer:  function (k, tt) { return [156, 172 + 7 * Math.sin(tt * 9 + (k === 'L' ? 0 : 1))]; },
    point:  function (k, tt) { return k === 'R' ? [92, 88] : POSES.down(k, tt); },
    highFive: function (k, tt) { return k === 'R' ? [138, 158] : POSES.down(k, tt); },
    hips:   function () { return [40, -40]; },
    shrug:  function (k, tt) { return [26, 112 + 6 * Math.sin(tt * 3)]; },
    clap:   function (k, tt) { return [12, -64 + 22 * Math.sin(tt * 14)]; },
    cover:  function () { return [14, -166]; },
    dance:  function (k, tt) { var ph = k === 'L' ? 0 : Math.PI; return [30 + 30 * Math.sin(tt * 7.5 + ph), 60 + 45 * Math.sin(tt * 7.5 + ph + 0.6)]; },
    // offering something and waiting for an answer
    openArms: function (k, tt) { return [58 + 3 * Math.sin(tt * 2.2 + (k === 'L' ? 0 : 1)), 70 + 4 * Math.sin(tt * 2.2 + (k === 'L' ? 0.5 : 1.5))]; },
    reach:  function (k, tt) { return k === 'R' ? [46 + 2 * Math.sin(tt * 2), 40] : POSES.down(k, tt); },
    pinky:  function (k, tt) { return k === 'R' ? [118, 150 + 3 * Math.sin(tt * 3)] : POSES.down(k, tt); },
    waitFive: function (k, tt) { return k === 'R' ? [138 + 2 * Math.sin(tt * 2.5), 158] : POSES.down(k, tt); },
    // holding things during her own day
    holdFront: function (k, tt) { return [4 + Math.sin(tt * 0.8 + (k === 'L' ? 0 : 1)) * 0.8, -42]; },
    water:  function (k, tt) { return k === 'R' ? [52, 46 + 8 * Math.sin(tt * 1.6)] : POSES.down(k, tt); },
    fan:    function (k, tt) { return k === 'R' ? [100, 150 + 16 * Math.sin(tt * 9)] : POSES.down(k, tt); },
    umbrella: function (k, tt) { return k === 'R' ? [70, 168] : POSES.down(k, tt); }
  };
  var FRONT = { crossFront: 1, clap: 1, cover: 1, holdFront: 1 };
  var armPlan = { next: 4 }, headPlan = { next: 3 }, leanPlan = { next: 5 }, timers = [];
  function later(sec, fn) { timers.push({ at: t + sec, fn: fn }); }
  function setPose(k, pose) {
    var a = arms[k]; a.pose = pose;
    if (FRONT[pose]) a.z = 'front';
    else if (a.z === 'front') later(0.7, function () { if (!FRONT[arms[k].pose]) arms[k].z = 'back'; });
  }
  function bothArms(pose) { setPose('L', pose); setPose('R', pose); }
  function planArms() {
    if (t < armPlan.next || grab || mood.state !== 'awake' || t < mood.flail || t < vibe.until) return;
    var ap = activityPose();
    if (ap) { if (ap === 'holdFront') { if (arms.L.pose !== ap) setPose('L', ap); if (arms.R.pose !== ap) setPose('R', ap); } else { if (arms.R.pose !== ap) setPose('R', ap); if (arms.L.pose !== 'down' && arms.L.pose !== 'swing') setPose('L', 'down'); } armPlan.next = t + 2; return; }
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
    if (t < headPlan.next && headPlan.locked) return;
    if (wander.dir) { head.face = wander.dir < 0 ? 'lookLeft' : 'lookRight'; head.target = wander.dir * 0.05; head.shiftT = wander.dir * 5; head.shiftYT = 0; headPlan.next = t + rnd(1, 2); return; }
    if (headPlan.forceTilt && t < headPlan.forceTilt.until) { head.target = headPlan.forceTilt.side * 0.07; head.shiftT = 0; head.shiftYT = 0; return; }
    if (t < headPlan.next) return;
    if (activityOn() && (activ.name === 'read' || activ.name === 'sketch') && Math.random() < 0.8) { head.face = 'lookDown'; head.target = 0; head.shiftT = 0; head.shiftYT = 8; headPlan.next = t + rnd(4, 9); return; }
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
    if (mood.state !== 'awake' || grab || t < vibe.until || PLACE.busy) { wander.target = wander.x; wander.tz = wander.z; return; }
    if (t < wander.next) return;
    var r = wanderRange(), zr = zRange(), far = TEMPER.name === 'sad' ? 250 : TEMPER.name === 'kind' || TEMPER.name === 'delighted' ? 900 : 650;
    for (var tries = 0; tries < 6; tries++) {
      var nx = Math.random() < 0.2 ? wander.x : clamp(wander.x + rnd(-far, far), r[0], r[1]);
      var nz = Math.random() < 0.35 ? wander.z : clamp(wander.z + rnd(-far, far) * 0.45, zr[0], zr[1]);
      if (freeSpot(nx, nz) && freeSpot((nx + wander.x) / 2, (nz + wander.z) / 2)) { wander.target = nx; wander.tz = nz; break; }
    }
    wander.next = t + rnd(9, 20);
  }

  // ---------- moves she can do on purpose (asked, or because she wants to) ----------
  var anim = { spin: null, nod: null, shake: null, bow: null, faint: null, float: null, shiver: 0, dance: 0, wiggle: 0, beat: 0 };
  var moves = { queue: [], until: 0 };
  function holdPose(which, pose, dur) {
    (which === 'both' ? ['L', 'R'] : [which]).forEach(function (k) { setPose(k, pose); later(dur, function () { if (arms[k].pose === pose) setPose(k, 'down'); }); });
  }
  function headFor(face, target, dur, shiftY) { head.face = face; head.target = target; head.shiftT = target * 50; head.shiftYT = shiftY || 0; headPlan.next = t + dur; }
  var MOVES = {
    wave: [2.6, function () { holdPose('R', 'waveR', 2.4); headFor('happy', 0.06, 2.4); }],
    wave_left: [2.6, function () { holdPose('L', 'waveL', 2.4); headFor('happy', -0.06, 2.4); }],
    cheer: [2.2, function () { holdPose('both', 'cheer', 2); body.vy -= 520; mark('sparkle', 1.6); headFor('happy', 0, 2); }],
    point: [2.4, function () { holdPose('R', 'point', 2.2); headFor('lookRight', 0.08, 2.2); }],
    hips: [3.2, function () { holdPose('both', 'hips', 3); }],
    cross_arms: [3.2, function () { holdPose('both', 'crossFront', 3); }],
    hands_behind: [3.2, function () { holdPose('both', 'crossBack', 3); }],
    shrug: [2, function () { holdPose('both', 'shrug', 1.8); headFor('main', 0.1, 1.8); }],
    clap: [2.2, function () { holdPose('both', 'clap', 2); var p = headPt(V(830, 380)); word(['パチパチ'], V(p.x + 40, p.y), { size: 48, dur: 1.6 }); }],
    cover_face: [2.4, function () { holdPose('both', 'cover', 2.2); showFace('boop', 2.2); }],
    rub_head: [3, function () { setPose('R', 'rubUp'); later(0.4, function () { if (arms.R.pose === 'rubUp') setPose('R', 'rub'); }); later(2.4, function () { if (arms.R.pose === 'rub') { setPose('R', 'rubDown'); later(0.4, function () { if (arms.R.pose === 'rubDown') setPose('R', 'down'); }); } }); headPlan.forceTilt = { side: -1, until: t + 2.6 }; }],
    stretch: [2.8, function () { holdPose('both', 'cheer', 2.6); showFace('sleep', 2.4); var p = headPt(V(800, 60)); word(['ん〜'], V(p.x + 50, p.y), { size: 50, dur: 1.8 }); }],
    high_five: [1.8, function () { holdPose('R', 'highFive', 1.6); headFor('happy', 0.05, 1.6); }],
    hug: [2.8, function () { holdPose('both', 'crossFront', 2.6); body.sqv += 1.4; mark('hearts', 2.4); }],
    nod: [1.3, function () { anim.nod = { t0: t, dur: 1.2 }; }],
    shake_head: [1.4, function () { anim.shake = { t0: t, dur: 1.3 }; }],
    tilt_left: [2.4, function () { headPlan.forceTilt = { side: -1.9, until: t + 2.3 }; }],
    tilt_right: [2.4, function () { headPlan.forceTilt = { side: 1.9, until: t + 2.3 }; }],
    look_left: [2.4, function () { headFor('lookLeft', -0.1, 2.3); }],
    look_right: [2.4, function () { headFor('lookRight', 0.1, 2.3); }],
    look_down: [2.4, function () { headFor('lookDown', 0, 2.3, 10); }],
    jump: [1.3, function () { body.vy -= 1300; body.sqv -= 2.2; }],
    hop: [0.8, function () { body.vy -= 650; body.sqv -= 1.2; }],
    spin: [1.2, function () { anim.spin = { t0: t, dur: 0.95, dir: Math.random() < 0.5 ? -1 : 1, a0: body.a }; }],
    bow: [2, function () { anim.bow = { t0: t, dur: 1.8 }; holdPose('both', 'crossFront', 1.8); showFace('lookDown', 1.8); }],
    dance: [6.4, function () { anim.dance = t + 6.2; holdPose('both', 'dance', 6.2); showFace('happy', 6); }],
    wiggle: [1.8, function () { anim.wiggle = t + 1.6; }],
    stomp: [2, function () { for (var i = 0; i < 3; i++) later(i * 0.42, function () { body.vy -= 420; cam.shake = 0.25; }); mark('vein', 1.6); showFace('fedUp', 1.8); var p = headPt(V(800, 100)); word(['ドン', 'ムッ'], V(p.x + 60, p.y), { size: 58 }); emit('buzz', { ms: [60, 360, 60, 360, 60] }); }],
    faint: [3.2, function () { anim.faint = { t0: t, dur: 3, side: Math.random() < 0.5 ? -1 : 1 }; showFace('sleep', 2.6); }],
    float_up: [2.8, function () { anim.float = { until: t + 2.6 }; showFace('content', 2.4); }],
    shiver: [1.7, function () { anim.shiver = t + 1.5; showFace('surprised', 1.5); mark('sweat', 1.4); }],
    blush: [2, function () { showFace('content', 2); mark('hearts', 2); }],
    walk_left: [0.5, function () { var r = wanderRange(); wander.target = clamp(wander.x - 520, r[0], r[1]); wander.next = t + 12; }],
    walk_right: [0.5, function () { var r = wanderRange(); wander.target = clamp(wander.x + 520, r[0], r[1]); wander.next = t + 12; }],
    walk_closer: [0.5, function () { var zr = zRange(); wander.tz = clamp(wander.z + 260, zr[0], zr[1]); wander.next = t + 12; }],
    walk_away: [0.5, function () { var zr = zRange(); wander.tz = clamp(wander.z - 260, zr[0], zr[1]); wander.next = t + 12; }],
    come_here: [0.5, function () { var r = wanderRange(), zr = zRange(), cs = view.k * cam.s; wander.target = clamp(-cam.x / cs, r[0], r[1]); wander.tz = clamp(Math.max(wander.z, zr[1] * 0.45), zr[0], zr[1]); wander.next = t + 12; }],
    nap: [0.5, function () { setMood('asleep'); }],
    sneeze: [1.4, function () { anim.nod = { t0: t + 0.35, dur: 0.5 }; showFace('sleep', 0.5); later(0.35, function () { body.vy -= 260; body.sqv += 1.2; var p = headPt(V(800, 300)); word(['ハクション', 'くしゅん', 'Achoo!'], V(p.x + 70, p.y), { size: 50, dur: 1.2 }); emit('sneeze'); }); }]
  };
  function perform(list) {
    (Array.isArray(list) ? list : [list]).slice(0, 6).forEach(function (m) { if (MOVES[m]) moves.queue.push(m); });
  }
  function moveTick() {
    if (!moves.queue.length || t < moves.until || grab || mood.state === 'fedUp' || PLACE.busy) return;
    var m = moves.queue.shift(), def = MOVES[m];
    if (mood.state === 'asleep' && m !== 'nap') setMood('awake');
    moves.until = t + def[0]; def[1]();
    armPlan.next = Math.max(armPlan.next, moves.until + 2); headPlan.next = Math.max(headPlan.next, t + def[0]); mood.lastTouch = t;
  }

  // ---------- faces, moods, reactions ----------
  var WORDS = { poke: ['つん', 'ぷに', 'ぽよ'], annoyed: ['ムッ'], gloom: ['ずーん'], relief: ['ふぅ…'], grab: ['!?', 'ひゃ'],
                wake: ['はっ!', '!?'], refuse: ['やだ!', 'もう!'], zzz: ['Zzz', 'すぴー', 'くー'], note: ['♪', '♫', 'ふんふん'], dizzy: ['@_@', 'ぐるぐる'], giggle: ['えへ', 'ふふっ', 'くすっ'], munch: ['もぐもぐ', 'はむっ'] };
  function word(list, at, opt) { fx.push({ kind: 'word', text: oneOf(list), x: at.x, y: at.y, t0: t, dur: (opt && opt.dur) || 1.15, tilt: rnd(-0.16, 0.16), size: (opt && opt.size) || 72, drift: (opt && opt.drift) || 0 }); }
  function mark(kind, dur) { fx.push({ kind: kind, t0: t, dur: dur, side: Math.random() < 0.5 ? -1 : 1 }); }
  function showFace(name, sec) { react = { face: name, until: t + sec }; }
  // her rarest face: utter shock or fury, a few seconds at most
  function shock(sec, kind) {
    mood.shockUntil = t + clamp(sec || 4, 1, 5);
    if (mood.state === 'asleep') setMood('awake');
    body.vy -= 700; body.sqv -= 1.6; cam.shake = 0.35;
    var p = headPt(V(820, 60)); word(kind === 'fury' ? ['ハァ!?', 'ムカッ'] : ['えっ!?', '!!'], V(p.x + 70, p.y), { size: 78, dur: 1.6 });
    mark(kind === 'fury' ? 'vein' : 'sweat', clamp(sec || 4, 1, 5));
  }
  var offering = null;
  function offerPose(kind) {
    var pose = { hug: 'openArms', hand: 'reach', pinky: 'pinky', highfive: 'waitFive', pat: null }[kind];
    offering = { kind: kind, pose: pose };
    if (mood.state === 'asleep') setMood('awake');
    if (pose === 'openArms') bothArms(pose); else if (pose) setPose('R', pose);
    if (kind === 'pat') headPlan.forceTilt = { side: -1.2, until: t + 30 };
    head.face = kind === 'hug' || kind === 'pat' ? 'content' : 'happy'; headPlan.next = t + 30; armPlan.next = t + 30;
  }
  function offerEnd() {
    if (!offering) return;
    if (offering.pose === 'openArms') bothArms('down'); else if (offering.pose) setPose('R', 'down');
    if (offering.kind === 'pat') headPlan.forceTilt = null;
    offering = null; armPlan.next = t + 2; headPlan.next = t + 1;
  }
  function heldWild() { return grab && (Math.abs(wrap(body.a)) > 1.5 || Math.abs(body.va) > 3.2); }
  function faceName() {
    if (t < (mood.shockUntil || 0) && IMG.face_shock) return 'shock';
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
  function refuse(at, kind, why) {
    mood.flail = t + 0.9; bothArms('flail');
    later(0.9, function () { if (mood.state === 'fedUp') bothArms('crossFront'); else bothArms('down'); });
    var away = at.x < bodyPt(COM).x ? 1 : -1;
    body.vx += away * 260; body.va += away * 2.2; cam.shake = 0.4;
    mark('vein', 1.2); word(WORDS.refuse, V(at.x, at.y - 90));
    if (mood.state === 'fedUp') mood.until += 1;
    emit('refused', { kind: kind, why: why || (mood.state === 'fedUp' ? 'fedUp' : null) });
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
    moveTick(); planArms(); planHead(); planLean(); planWander(); moodTick();

    var asleep = mood.state === 'asleep', sad = TEMPER.name === 'sad';
    var bob = reduceMotion ? 0 : asleep ? -4 + Math.sin(t * 0.7) * 5 : -10 + Math.sin(t * (sad ? 0.9 : 1.25)) * (sad ? 6 : 9);
    if (anim.float && t < anim.float.until) bob -= 230 * Math.sin(Math.PI * clamp(1 - (anim.float.until - t) / 2.6, 0, 1));
    if (t < anim.dance) { var beat = Math.floor(t * 2.4); if (beat !== anim.beat) { anim.beat = beat; body.vy -= 340; if (beat % 2) { var np = headPt(V(Math.random() < 0.5 ? 470 : 840, 80)); word(WORDS.note, np, { size: 46, dur: 1.2, drift: rnd(-30, 30) }); } } }
    var sway = reduceMotion ? 0 : Math.sin(t * 0.8) * (asleep ? 0.02 : 0.012);

    // wandering: a slow walk-like drift
    if (wander.goal) { wander.target = wander.goal.x; if (wander.goal.z != null) wander.tz = wander.goal.z; }
    var wdx = wander.target - wander.x, wdz = wander.tz - wander.z, wl = Math.hypot(wdx, wdz), wsp = (wander.goal ? 280 : 40) * dt;
    if (wl > 0.01 && !grab) { var wf = Math.min(1, wsp / wl); wander.x += wdx * wf; wander.z += wdz * wf; }
    wander.dir = Math.abs(wdx) > 6 && Math.abs(wdx) > Math.abs(wdz) * 0.5 && !grab ? Math.sign(wdx) : 0;
    if (wander.goal && Math.abs(wander.goal.x - wander.x) < 4 && Math.abs(wander.tz - wander.z) < 4 && Math.abs(body.x - wander.x) < 30) { var gcb = wander.goal.cb; wander.goal = null; if (gcb) gcb(); }
    if (grab) wander.goal = null;
    var cs = view.k * cam.s, bnd = SCENE.bounds(PLACE.name);
    if (ARR.drag) {
      var azx = view.w * 0.14, azy = view.h * 0.12, aex = ARR.drag.sx < azx ? -(1 - ARR.drag.sx / azx) : ARR.drag.sx > view.w - azx ? (ARR.drag.sx - view.w + azx) / azx : 0;
      var aey = ARR.drag.sy < azy ? -(1 - ARR.drag.sy / azy) : ARR.drag.sy > view.h - azy ? (ARR.drag.sy - view.h + azy) / azy : 0;
      if (aex || aey) { cam.x -= aex * 700 * dt; cam.y = clamp(cam.y - aey * 520 * dt, -view.h * 1.4, view.h * 1.4); var aw2 = toWorld(ARR.drag.sx, ARR.drag.sy); SCENE.moveProp(ARR.drag.id, aw2.x + ARR.drag.dx, aw2.y + ARR.drag.dy); }
    }
    // dragging her towards an edge of the screen: the view follows
    if (grab && grab.sx != null) {
      var ezx = view.w * 0.16, ezy = view.h * 0.12;
      var ex = grab.sx < ezx ? -(1 - grab.sx / ezx) : grab.sx > view.w - ezx ? (grab.sx - view.w + ezx) / ezx : 0;
      var ey = grab.sy < ezy ? -(1 - grab.sy / ezy) : grab.sy > view.h - ezy ? (grab.sy - view.h + ezy) / ezy : 0;
      if (ex) { cam.x -= ex * 700 * dt; cam.free = t + 1.5; }
      if (ey) { cam.y = clamp(cam.y - ey * 520 * dt, -view.h * 1.4, view.h * 1.4); cam.free = t + 1.5; }
      var gw = toHer(grab.sx, grab.sy); grab.tx = gw.x; grab.ty = gw.y;
    }
    // the camera follows her along the garden (and up and down it) unless you're looking around
    if (!pan && !pinch && !grab && !ARR.on && t > cam.free) cam.x += (-body.x * cs - cam.x) * Math.min(1, dt * 1.6);
    if (!pan && !pinch && !ARR.on) { var wantYd = -wander.z * 0.57 * cs, nyd = cam.yd + (wantYd - cam.yd) * Math.min(1, dt * 1.6); cam.y += nyd - cam.yd; cam.yd = nyd; }
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
      if (body.y > 0) { var zr2 = zRange(), s0 = dScale(wander.z), nz2 = clamp(wander.z + body.y * s0, zr2[0], zr2[1]); body.y -= (nz2 - wander.z) / s0; if (body.vy > 0 && nz2 > wander.z) body.vy *= 0.5; wander.z = wander.tz = nz2; }
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
      var shakeX = t < mood.flail ? Math.sin(t * 46) * 900 : t < anim.shiver ? Math.sin(t * 60) * 700 : 0;
      body.vx += (14 * (wander.x - body.x) - 2 * Math.sqrt(14) * 0.85 * body.vx + shakeX) * dt;
      body.vy += (14 * (bob - body.y) - 2 * Math.sqrt(14) * 0.85 * body.vy) * dt;
      body.x += body.vx * dt; body.y += body.vy * dt;
      var walkLean = wander.dir * 0.06, vibeSway = t < vibe.until && vibe.likes ? Math.sin(t * 2 * Math.PI * 0.95) * 0.06 : 0;
      var extraA = (t < anim.dance ? Math.sin(t * 2 * Math.PI * 1.2) * 0.13 : 0) + (t < anim.wiggle ? Math.sin(t * 20) * 0.12 : 0);
      if (anim.faint) { var fu = (t - anim.faint.t0) / anim.faint.dur; if (fu >= 1) anim.faint = null; else extraA += anim.faint.side * 1.25 * Math.sin(Math.PI * Math.min(1, fu * 1.25)) ; }
      spring(body, 'a', 'va', lean + sway + walkLean + vibeSway + extraA + (t < mood.flail ? Math.sin(t * 30) * 0.08 : 0), 22, 2 * Math.sqrt(22) * 0.75, 0, dt);
      if (anim.spin) { var su = (t - anim.spin.t0) / anim.spin.dur; if (su >= 1) { body.a = wrap(anim.spin.a0); body.va = 0; anim.spin = null; } else { body.a = anim.spin.a0 + anim.spin.dir * 2 * Math.PI * ease(su); body.va = 0; } }
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
    if (anim.shake) { var shu = (t - anim.shake.t0) / anim.shake.dur; if (shu >= 1) anim.shake = null; else bobHead += 0.16 * Math.sin(shu * Math.PI * 6) * (1 - shu); }
    if (t < anim.dance) bobHead += Math.sin(t * 2 * Math.PI * 1.2) * 0.08;
    spring(head, 'r', 'v', head.target + bobHead, t < vibe.until ? 90 : 28, 2 * Math.sqrt(28) * 0.8, -hx * 0.00025, dt);
    var nodY = 0, bowY = 0;
    if (anim.nod) { var nu = (t - anim.nod.t0) / anim.nod.dur; if (nu >= 1) anim.nod = null; else nodY = 18 * Math.abs(Math.sin(nu * Math.PI * 3)); }
    if (anim.bow) { var bu = (t - anim.bow.t0) / anim.bow.dur; if (bu >= 1) anim.bow = null; else bowY = 34 * Math.sin(Math.PI * bu); }
    head.shift += (head.shiftT - head.shift) * Math.min(1, dt * 6);
    head.shiftY += (head.shiftYT + nodY + bowY - head.shiftY) * Math.min(1, dt * (asleep ? 1.5 : nodY ? 16 : 5));
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
      } else if (f.kind === 'hearts') {
        [[830, 90, 1], [480, 120, 0.8], [900, 200, 0.65]].forEach(function (h, j) {
          var y = h[1] - 90 * ease(u) - j * 12, s2 = h[2] * (0.7 + 0.3 * Math.sin((t - f.t0) * 6 + j));
          ctx.save(); ctx.translate(h[0], y); ctx.scale(s2, s2);
          ctx.beginPath(); ctx.moveTo(0, 14); ctx.bezierCurveTo(-34, -10, -16, -40, 0, -20); ctx.bezierCurveTo(16, -40, 34, -10, 0, 14);
          ctx.fillStyle = '#f39ab6'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#5b4944'; ctx.stroke(); ctx.restore();
        });
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
  function sprite(name, x, y) { ctx.drawImage(wear.yukata && /^(dress|skirt|upper_|fore_)/.test(name) ? (yukata(name) || IMG[name]) : IMG[name], x, y); M[name] = ctx.getTransform().inverse(); M[name].ox = x; M[name].oy = y; }
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
      drawWearBody();
    });
    ['R', 'L'].forEach(function (k) { if (arms[k].z === 'front') drawFore(k); });
    var fnm = faceName(), F = RIG.faces[fnm] || RIG.faces.main;
    withHead(function () { sprite('face_' + fnm, F.x, F.y); drawWearHead(); drawExtras(); });
    drawProps();
    withHead(drawDream);
  }

  // ---------- her own day: what she holds, what she wears ----------
  var activ = { name: null, pause: 0 }, wear = { scarf: false, straw: false, party: false, yukata: false, umbrella: false };
  function activityOn() { return activ.name && mood.state === 'awake' && !grab && t > activ.pause && t >= moves.until && !offering && !extras.food && t > mood.flail && !PLACE.busy; }
  function activityPose() {
    if (wear.umbrella && mood.state === 'awake' && !grab && !offering && t >= moves.until) return 'umbrella';
    if (!activityOn()) return null;
    return { read: 'holdFront', tea: 'holdFront', sketch: 'holdFront', water: 'water', fan: 'fan' }[activ.name] || null;
  }
  function setActivity(name) {
    if (activ.name === name) return;
    var was = activ.name; activ.name = name || null;
    if (was && !name) { bothArms('down'); armPlan.next = t + 1.5; head.shiftYT = 0; }
    armPlan.next = Math.min(armPlan.next, t + 0.3);
  }
  // the yukata: her dress and sleeves redrawn in indigo with little flowers (made once)
  var YK = {};
  function yukata(name) {
    if (YK[name] !== undefined) return YK[name];
    var im = IMG[name]; if (!im) return (YK[name] = null);
    var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    var g = c.getContext('2d'); g.drawImage(im, 0, 0);
    var d = g.getImageData(0, 0, c.width, c.height), px = d.data, W = c.width, off = { dress: [534, 346], skirt: [533, 708], upper_L: [0, 0], upper_R: [0, 0], fore_L: [0, 0], fore_R: [0, 0] }[name] || [0, 0];
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 10) continue;
      var r = px[i], gg = px[i + 1], b = px[i + 2], lum = (r + gg + b) / 3, x = (i / 4) % W + off[0], y = Math.floor(i / 4 / W) + off[1];
      if (lum < 95) {
        // a flower every so often on the indigo
        var cx = Math.round(x / 74) * 74 + ((Math.round(y / 74) % 2) ? 37 : 0), cy = Math.round(y / 74) * 74, dx = x - cx, dy = y - cy, dd = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
        var petal = dd < 15 + 6 * Math.cos(ang * 5), k = lum / 95;
        if (lum > 35 && petal) { px[i] = dd < 5 ? 255 : 250; px[i + 1] = dd < 5 ? 214 : 196; px[i + 2] = dd < 5 ? 110 : 210; }
        else { px[i] = 36 + 40 * k; px[i + 1] = 48 + 46 * k; px[i + 2] = 104 + 60 * k; }
      } else if (lum > 200 && b > 180) { px[i] = 236; px[i + 1] = 240; px[i + 2] = 252; }
    }
    g.putImageData(d, 0, 0);
    return (YK[name] = c);
  }
  function drawWearBody() {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 6;
    if (wear.yukata) {    // the obi
      ctx.fillStyle = '#f39ab6'; ctx.beginPath(); ctx.moveTo(552, 676); ctx.quadraticCurveTo(667, 690, 786, 674); ctx.lineTo(790, 742); ctx.quadraticCurveTo(667, 756, 548, 742); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.moveTo(552, 704); ctx.quadraticCurveTo(667, 716, 788, 702); ctx.lineTo(788, 714); ctx.quadraticCurveTo(667, 728, 552, 716); ctx.closePath(); ctx.fill();
    }
    if (wear.scarf) {
      ctx.fillStyle = '#ee8a8a';
      ctx.beginPath(); ctx.moveTo(588, 392); ctx.quadraticCurveTo(667, 430, 748, 390); ctx.lineTo(752, 440); ctx.quadraticCurveTo(667, 486, 584, 440); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(700, 448); ctx.lineTo(742, 452); ctx.lineTo(736, 590); ctx.lineTo(694, 580); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d06c6c'; ctx.lineWidth = 4; for (var i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(700 + i * 2, 480 + i * 26); ctx.lineTo(740 - i * 1, 482 + i * 26); ctx.stroke(); }
      ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 5; for (var j = 0; j < 5; j++) { ctx.beginPath(); ctx.moveTo(700 + j * 9, 582 + (j % 2) * 3); ctx.lineTo(699 + j * 9, 606); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawWearHead() {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 7;
    if (wear.straw) {
      ctx.fillStyle = '#f2d58a'; ctx.beginPath(); ctx.ellipse(655, 108, 300, 62, -0.04, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(500, 104); ctx.bezierCurveTo(505, -30, 805, -30, 810, 98); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ee8a8a'; ctx.beginPath(); ctx.moveTo(502, 70); ctx.bezierCurveTo(600, 92, 720, 92, 808, 66); ctx.lineTo(810, 98); ctx.bezierCurveTo(720, 122, 600, 122, 500, 100); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (wear.party) {
      ctx.save(); ctx.translate(560, 70); ctx.rotate(-0.32);
      ctx.fillStyle = '#a9d9f2'; ctx.beginPath(); ctx.moveTo(-70, 30); ctx.lineTo(0, -190); ctx.lineTo(70, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f39ab6'; [[-30, -20], [20, -70], [-6, -120], [28, 4]].forEach(function (d) { ctx.beginPath(); ctx.arc(d[0], d[1], 11, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(0, -196, 24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  // things she holds, drawn at her real hands
  function drawProps() {
    var on = activityOn() && !(wear.umbrella && arms.R.pose === 'umbrella'), name = on ? activ.name : null;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 6;
    if (name === 'read' || name === 'sketch' || name === 'tea') {
      var L = handW('L'), Rh = handW('R'), mx = (L.x + Rh.x) / 2, my = (L.y + Rh.y) / 2 - 10;
      if (name === 'tea') {
        ctx.fillStyle = '#a9c3a0'; ctx.beginPath(); ctx.moveTo(mx - 46, my - 40); ctx.lineTo(mx + 46, my - 40); ctx.lineTo(mx + 36, my + 34); ctx.lineTo(mx - 36, my + 34); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8fb986'; ctx.beginPath(); ctx.ellipse(mx, my - 40, 46, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 6; for (var st = 0; st < 2; st++) { var o = (t * 0.45 + st * 0.5) % 1; ctx.globalAlpha = 1 - o; ctx.beginPath(); ctx.moveTo(mx - 10 + st * 20, my - 56 - o * 90); ctx.quadraticCurveTo(mx + 8 + st * 20, my - 76 - o * 90, mx - 10 + st * 20, my - 96 - o * 90); ctx.stroke(); } ctx.globalAlpha = 1;
      } else {
        var open = name === 'read', w = 150, h = 110;
        ctx.save(); ctx.translate(mx, my - 20); ctx.rotate(-0.08);
        if (open) {
          ctx.fillStyle = '#f39ab6'; ctx.beginPath(); ctx.moveTo(-w, -h / 2 + 8); ctx.lineTo(0, -h / 2 + 22); ctx.lineTo(w, -h / 2 + 8); ctx.lineTo(w, h / 2); ctx.lineTo(0, h / 2 + 14); ctx.lineTo(-w, h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.moveTo(-w + 12, -h / 2 + 2); ctx.quadraticCurveTo(-w / 2, -h / 2 - 8, 0, -h / 2 + 14); ctx.quadraticCurveTo(w / 2, -h / 2 - 8, w - 12, -h / 2 + 2); ctx.lineTo(w - 12, h / 2 - 8); ctx.quadraticCurveTo(w / 2, h / 2 - 16, 0, h / 2 + 4); ctx.quadraticCurveTo(-w / 2, h / 2 - 16, -w + 12, h / 2 - 8); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.lineWidth = 3; ctx.strokeStyle = '#c9b9b2'; for (var ln = 0; ln < 4; ln++) { ctx.beginPath(); ctx.moveTo(-w + 30, -h / 2 + 26 + ln * 18); ctx.lineTo(-22, -h / 2 + 30 + ln * 18); ctx.moveTo(22, -h / 2 + 30 + ln * 18); ctx.lineTo(w - 30, -h / 2 + 26 + ln * 18); ctx.stroke(); }
        } else {
          ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.rect(-w * 0.8, -h * 0.7, w * 1.6, h * 1.3); ctx.fill(); ctx.stroke();
          ctx.lineWidth = 4; ctx.strokeStyle = '#94c191'; ctx.beginPath(); ctx.moveTo(-70, 30); ctx.quadraticCurveTo(-20, -40, 30, 10); ctx.quadraticCurveTo(60, 40, 80, -20); ctx.stroke();
          ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(60 + Math.sin(t * 5) * 14, 50); ctx.lineTo(130 + Math.sin(t * 5) * 14, -20); ctx.stroke();
        }
        ctx.restore();
      }
    } else if (name === 'water') {
      var H = handW('R');
      ctx.save(); ctx.translate(H.x + 30, H.y + 40); ctx.rotate(0.35 + 0.1 * Math.sin(t * 1.6));
      ctx.fillStyle = '#a9c3f0'; ctx.beginPath(); ctx.moveTo(-60, -50); ctx.lineTo(60, -50); ctx.lineTo(70, 60); ctx.lineTo(-70, 60); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(60, 20); ctx.lineTo(170, -40); ctx.lineTo(178, -26); ctx.lineTo(66, 44); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-40, -50); ctx.quadraticCurveTo(0, -110, 40, -50); ctx.stroke();
      ctx.fillStyle = '#82bad9'; for (var dr = 0; dr < 4; dr++) { var u2 = (t * 1.3 + dr / 4) % 1; ctx.beginPath(); ctx.arc(176 + u2 * 30, -30 + u2 * 220, 7, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    } else if (name === 'fan') {
      var F2 = handW('R');
      ctx.save(); ctx.translate(F2.x, F2.y); ctx.rotate(-0.4 + 0.25 * Math.sin(t * 9));
      ctx.fillStyle = '#c49a74'; ctx.fillRect(-6, -10, 12, 90); ctx.strokeRect(-6, -10, 12, 90);
      ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.ellipse(0, -90, 80, 86, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#82bad9'; ctx.beginPath(); ctx.moveTo(-60, -70); ctx.quadraticCurveTo(-20, -100, 0, -70); ctx.quadraticCurveTo(20, -40, 60, -70); ctx.lineTo(60, -40); ctx.quadraticCurveTo(20, -10, 0, -40); ctx.quadraticCurveTo(-20, -70, -60, -40); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (wear.umbrella && arms.R.pose === 'umbrella') {
      var U = handW('R'), top = headPt(V(640, -200)), topX = top.x, topY = top.y;
      ctx.lineWidth = 8; ctx.strokeStyle = '#5b4944'; ctx.beginPath(); ctx.moveTo(U.x, U.y + 40); ctx.lineTo(topX, topY); ctx.stroke();
      ctx.fillStyle = '#f39ab6'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(topX - 420, topY + 210); ctx.quadraticCurveTo(topX, topY - 120, topX + 420, topY + 210);
      for (var sg = 0; sg < 6; sg++) { var x0 = topX + 420 - sg * 140; ctx.quadraticCurveTo(x0 - 70, topY + 175, x0 - 140, topY + 210); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 4; for (var rb = 1; rb < 6; rb++) { ctx.beginPath(); ctx.moveTo(topX, topY + 6); ctx.lineTo(topX + 420 - rb * 140, topY + 205); ctx.stroke(); }
      ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(topX, topY + 30, 46, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- earmuffs (music muted for her) and a snack in front of her mouth ----------
  var extras = { muffs: false, food: null };
  var sickOn = false, dreamSy = [];
  function drawSick() {
    if (!sickOn) return;
    ctx.save(); ctx.globalAlpha = 0.55;
    [[592, 334], [734, 334]].forEach(function (c) { var g = ctx.createRadialGradient(c[0], c[1], 4, c[0], c[1], 44); g.addColorStop(0, 'rgba(240,110,120,0.9)'); g.addColorStop(1, 'rgba(240,110,120,0)'); ctx.fillStyle = g; ctx.fillRect(c[0] - 46, c[1] - 46, 92, 92); });
    ctx.globalAlpha = 0.75; ctx.fillStyle = '#ee7f86'; ctx.beginPath(); ctx.ellipse(662, 352, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // little doodles floating up from her head while she sleeps
  function drawDream() {
    if (mood.state !== 'asleep' || !dreamSy.length) return;
    var i = Math.floor(t / 6) % dreamSy.length, u = (t / 6) % 1, al = Math.min(1, u * 5, (1 - u) * 5);
    var bx = 1040, by = 90;
    ctx.save(); ctx.lineWidth = 6; ctx.strokeStyle = '#5b4944'; ctx.fillStyle = '#fffaf0';
    [[860, 250, 14], [905, 200, 22]].forEach(function (c) { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.beginPath(); for (var k = 0; k <= 16; k++) { var a = k / 16 * Math.PI * 2, r = 1 + 0.12 * Math.sin(a * 6); ctx.lineTo(bx + Math.cos(a) * 130 * r, by + Math.sin(a) * 96 * r); } ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = al; ctx.translate(bx, by + Math.sin(t * 1.5) * 4); ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    doodle(dreamSy[i]);
    ctx.restore();
  }
  function doodle(k) {
    var c = ctx; c.strokeStyle = '#5b4944';
    function fill(col) { c.fillStyle = col; c.fill(); c.stroke(); }
    c.beginPath();
    if (k === 'fish' || k === 'food') { c.moveTo(-60, 0); c.quadraticCurveTo(-10, -50, 40, 0); c.quadraticCurveTo(-10, 50, -60, 0); c.closePath(); fill(k === 'food' ? '#e2a65f' : '#f6a046'); c.beginPath(); c.moveTo(40, 0); c.lineTo(70, -26); c.lineTo(70, 26); c.closePath(); fill(k === 'food' ? '#e2a65f' : '#f6a046'); }
    else if (k === 'book') { c.rect(-60, -40, 56, 80); fill('#a9c3f0'); c.beginPath(); c.rect(4, -40, 56, 80); fill('#f6a4a4'); }
    else if (k === 'cat') { c.arc(0, 10, 44, 0, Math.PI * 2); fill('#ffffff'); c.beginPath(); c.moveTo(-40, -10); c.lineTo(-34, -60); c.lineTo(-10, -32); c.moveTo(40, -10); c.lineTo(34, -60); c.lineTo(10, -32); c.stroke(); c.beginPath(); c.arc(-15, 6, 4, 0, 7); c.arc(15, 6, 4, 0, 7); c.fillStyle = '#5b4944'; c.fill(); }
    else if (k === 'rain') { c.arc(-20, -10, 30, Math.PI, 0); c.arc(20, -16, 34, Math.PI, 0); c.closePath(); fill('#dfe7f3'); [-30, 0, 30].forEach(function (x) { c.beginPath(); c.moveTo(x, 30); c.lineTo(x - 6, 52); c.stroke(); }); }
    else if (k === 'note') { c.ellipse(-20, 30, 18, 13, -0.4, 0, 7); fill('#5b4944'); c.beginPath(); c.moveTo(-4, 26); c.lineTo(-4, -44); c.lineTo(36, -54); c.lineTo(36, -24); c.stroke(); }
    else if (k === 'star') { for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 22 : 52; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); fill('#ffe08a'); }
    else if (k === 'swirl') { for (var j = 0; j < 40; j++) { var b = j * 0.4, rr = j * 1.4; c.lineTo(Math.cos(b) * rr, Math.sin(b) * rr); } c.stroke(); }
    else if (k === 'shoe') { c.moveTo(-50, 20); c.lineTo(-50, -30); c.lineTo(-10, -30); c.quadraticCurveTo(0, 0, 50, 6); c.lineTo(50, 24); c.closePath(); fill('#f8c4d3'); }
    else if (k === 'heart') { c.moveTo(0, 40); c.bezierCurveTo(-70, -10, -30, -60, 0, -24); c.bezierCurveTo(30, -60, 70, -10, 0, 40); fill('#f39ab6'); }
    else if (k === 'house') { c.moveTo(-50, 40); c.lineTo(-50, -10); c.lineTo(0, -50); c.lineTo(50, -10); c.lineTo(50, 40); c.closePath(); fill('#f6d9a8'); }
    else if (k === 'moon') { c.arc(0, 0, 46, 0.6, Math.PI * 2 - 0.6); c.quadraticCurveTo(10, 0, 37, 26); fill('#fff3c4'); }
    else if (k === 'phone') { c.roundRect(-30, -50, 60, 100, 12); fill('#5b4944'); c.beginPath(); c.rect(-22, -40, 44, 76); fill('#c4e5f5'); }
    else { c.arc(-24, 0, 30, 0, 7); c.arc(20, -10, 36, 0, 7); fill('#ffffff'); }
  }
  function drawExtras() {
    var lw = 7;
    drawSick();
    if (extras.muffs) {
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = '#5b4944'; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(468, 230); ctx.bezierCurveTo(470, -40, 840, -40, 842, 230); ctx.stroke();
      ctx.strokeStyle = '#f39ab6'; ctx.lineWidth = 34 - lw * 2; ctx.stroke();
      [[462, 252], [848, 252]].forEach(function (m) {
        ctx.beginPath();
        for (var i = 0; i <= 14; i++) { var a = i / 14 * Math.PI * 2, r = 1 + 0.09 * Math.sin(a * 7); ctx.lineTo(m[0] + Math.cos(a) * 62 * r, m[1] + Math.sin(a) * 76 * r); }
        ctx.closePath(); ctx.fillStyle = '#f8c4d3'; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = '#5b4944'; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(m[0] - 14, m[1] - 22, 14, 18, -0.4, 0, Math.PI * 2); ctx.fillStyle = '#fde3eb'; ctx.fill();
      });
      ctx.restore();
    }
    var f = extras.food;
    if (f) {
      var u = (t - f.t0) / f.dur; if (u > 1) { extras.food = null; return; }
      var size = 230 * (1 - 0.45 * Math.floor(u * 4) / 4), bob = Math.sin(u * Math.PI * 8) * 10;
      ctx.save(); ctx.globalAlpha = u > 0.85 ? (1 - u) / 0.15 : 1;
      ctx.drawImage(f.img, 655 - size / 2, 400 - size * 0.25 + bob, size, size * f.img.height / f.img.width);
      ctx.restore();
    }
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
    var p = toHer(sx, sy), best = null, slop = 30 / (view.k * cam.s * dScale(wander.z)) * 0.6 + 18;
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
  var pointers = new Map(), pinch = null, pan = null, lastTap = 0, press = null, pan0 = null, HANDLE = null;
  // arranging the garden: drag her things around instead of her
  var ARR = { on: false, drag: null };
  function setArrange(on) {
    ARR.on = !!on; ARR.drag = null; SCENE.setArrange(ARR.on, null);
    cam.free = ARR.on ? t + 1e9 : t + 1;
    if (ARR.on && PLACE.name !== 'garden') ARR.on = false;
  }
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
    if (ARR.on) {
      var aw = toWorld(p.x, p.y), aid = SCENE.propAt(aw.x, aw.y);
      if (aid) { var ap = SCENE.posOf(aid); ARR.drag = { id: aid, dx: ap[0] - aw.x, dy: ap[1] - aw.y, sx: p.x, sy: p.y, moved: false }; SCENE.setArrange(true, aid); emit('arrangePick', { id: aid }); }
      else pan = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, at: Date.now(), moved: false };
      return;
    }
    var w = toHer(p.x, p.y), face = 'face_' + faceName();
    var arm = hitArm(p.x, p.y, true);
    if (!arm && !onSprite([face, 'dress'], p.x, p.y)) arm = hitArm(p.x, p.y, false);
    var onLegs = !arm && !onSprite([face, 'dress', 'skirt'], p.x, p.y) && onSprite(['legs'], p.x, p.y);
    var onBody = !arm && !onLegs && onSprite([face, 'dress', 'skirt', 'legs', 'hairback'], p.x, p.y);
    finger.last = null; finger.v = V(0, 0); finger.a = V(0, 0);
    if (arm || onLegs || onBody) activ.pause = t + 75;
    var hk = arm ? 'arm' : onLegs ? 'leg' : onBody ? 'body' : null, rule = null;
    if (hk) {
      rule = HANDLE ? HANDLE(hk, mood.state) : null;
      var verdict = rule && rule.v || (mood.state === 'fedUp' ? 'refuse' : 'ok');
      if (verdict === 'refuse') { refuse(w, hk, rule && rule.why); return; }
      if (mood.state === 'fedUp') { mood.lastTouch = t; mood.until = Math.min(mood.until || t + 2, t + 1.5); emit('soothed', { kind: hk }); }
      else touchStart();
    }
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
      if (now - lastTap < 320) { cam.s = 1; cam.y = 0; cam.yd = 0; cam.free = 0; }
      lastTap = now;
      pan = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, at: Date.now(), moved: false }; pan0 = { x: p.x, y: p.y };
    }
    if (grab) {
      grab.sx = p.x; grab.sy = p.y;
      cv.classList.add('grabbing');
      press = { x: p.x, y: p.y, at: Date.now(), world: w, type: grab.type, moved: false };
      var myPress = press;
      later(0.55, function () {
        if (press !== myPress || press.moved || pointers.size !== 1 || !grab) return;
        press.held = true; grab = null; cv.classList.remove('grabbing');
        emit('hold', { x: press.x, y: press.y });
      });
      emit('grab', { type: grab.type });
      if (rule && rule.v === 'wriggle') { var myGrab = grab; later(rnd(0.7, 1.3), function () { if (grab !== myGrab) return; grab = null; press = null; cv.classList.remove('grabbing'); var away = rnd(-1, 1) < 0 ? -1 : 1; body.vx += away * 320; body.va += away * 2.4; mood.flail = t + 0.7; bothArms('flail'); later(0.7, function () { bothArms('down'); }); mark('vein', 1.1); word(WORDS.refuse, headPt(V(820, 60))); emit('wriggled', { kind: hk }); }); }
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
    if (ARR.drag) { ARR.drag.sx = p.x; ARR.drag.sy = p.y; ARR.drag.moved = true; var dw = toWorld(p.x, p.y); SCENE.moveProp(ARR.drag.id, dw.x + ARR.drag.dx, dw.y + ARR.drag.dy); return; }
    if (press && Math.hypot(p.x - press.x, p.y - press.y) > 9) press.moved = true;
    if (grab) { grab.sx = p.x; grab.sy = p.y; var w = toHer(p.x, p.y); grab.tx = w.x; grab.ty = w.y; if (grab.type === 'leg' && Math.abs(wrap(body.a)) > 2.4 && !grab.upside) { grab.upside = true; emit('upside'); } }
    else if (pan) { if (Math.hypot(p.x - pan.x, p.y - pan.y) > 9) pan.moved = true; cam.x = pan.cx + (p.x - pan.x); cam.y = clamp(pan.cy + (p.y - pan.y), -view.h * 1.1, view.h * 1.1); cam.free = t + 8; }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && ARR.on) {
      if (ARR.drag) { emit('arranged', { id: ARR.drag.id, layout: SCENE.layout() }); ARR.drag = null; SCENE.setArrange(true, null); }
      pan = null; return;
    }
    if (pointers.size === 0) {
      var wasBoop = press && !press.moved && !press.held && Date.now() - press.at < 280, at = press && press.world;
      if (grab && grab.type === 'leg' && Math.abs(grab.turned) > Math.PI * 2) {
        var turns = Math.abs(grab.turned) / (Math.PI * 2);
        emit('spun', { turns: turns }); var hp = headPt(V(820, 60)); word(WORDS.dizzy, V(hp.x + 30, hp.y)); showFace('boop', 1.6);
      }
      var wasTap = pan && !pan.moved && Date.now() - pan.at < 350, grab0 = grab;
      grab = null; pan = null; press = null; cv.classList.remove('grabbing');
      if (wasBoop) boop(at);
      else if (wasTap) {
        var tw = toWorld(pan0.x, pan0.y), thing = SCENE.hit ? SCENE.hit(tw.x, tw.y, PLACE.name) : null;
        emit('tapWorld', { x: tw.x, y: tw.y, sx: pan0.x, sy: pan0.y, thing: thing });
        if (!thing) callTo(tw.x, tw.y);
      }
      if (grab0 && grab0.type !== 'leg') { var wr0 = wanderRange(); wander.x = wander.target = clamp(wander.x, wr0[0], wr0[1]); }
    }
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  // you tapped a spot on the floor: she walks over, if she feels like it
  function callTo(wx, wy) {
    var zr = zRange(), r = wanderRange();
    if (wy < GROUND + zr[0] - 40 || wy > GROUND + zr[1] + 160) return;
    var x = clamp(wx - 660, r[0], r[1]), z = clamp(wy - GROUND, zr[0], zr[1]);
    if (!freeSpot(x, z)) { emit('called', { ok: false, why: 'blocked' }); return; }
    var no = mood.state !== 'awake' || PLACE.busy || grab || moves.queue.length || (TEMPER.name === 'dismissive' && Math.random() < 0.5) || (TEMPER.name === 'grumpy' && Math.random() < 0.3);
    if (no) { if (mood.state === 'awake') { head.face = x < wander.x ? 'lookLeft' : 'lookRight'; headPlan.next = t + 1.5; } emit('called', { ok: false, why: mood.state }); return; }
    activ.pause = t + 30;
    wander.goal = null; wander.target = x; wander.tz = z; wander.next = t + rnd(16, 30); mood.lastTouch = t;
    emit('called', { ok: true });
  }
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
                      place: PLACE.name, music: t < vibe.until && vibe.likes, focusX: -cam.x / cs, anchor: ANCHOR, herX: herOX(), herY: GROUND + wander.z },
      function () { ctx.setTransform(dpr, 0, 0, dpr, shx * dpr, shy * dpr); ctx.save(); worldTransform(); herXf(); drawHer(); ctx.restore(); });
    ctx.setTransform(dpr, 0, 0, dpr, shx * dpr, shy * dpr);
    drawNameTag();
    ctx.save(); worldTransform(); herXf(); withHead(drawMarks); drawWords(); ctx.restore();
    if (PLACE.fade > 0.003) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,248,236,' + PLACE.fade.toFixed(3) + ')'; ctx.fillRect(0, 0, view.w, view.h); }
  }
  // a small doodled name plate on the ground under her
  function drawNameTag() {
    var p = worldToScreen(herToWorld(V(662 + body.x * 0.9, GROUND + 30))), s = clamp(0.8 + (cam.s - 1) * 0.25, 0.7, 1.3) * dScale(wander.z);
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
        body.x = wander.x = wander.target = off; body.vx = 0; wander.z = wander.tz = 0;
        cam.x = -off * view.k * cam.s; cam.free = 0;
        emit('place', { place: name });
        var t1 = t;
        (function fadeIn() { PLACE.fade = Math.max(0, 1 - (t - t1) / 0.6); if (PLACE.fade > 0) return later(0.016, fadeIn); PLACE.busy = false; wander.next = t + 6; if (cb) cb(true); })();
      })();
    };
    if (name === 'house') { wander.goal = { x: doorOff, z: 0, cb: startFade }; }
    else startFade();
  }
  // what the rest of the app can ask of her body
  var BODY = {
    on: function (fn) { listeners.push(fn); },
    act: act, showFace: showFace, shock: shock, offer: offerPose, offerEnd: offerEnd, get offering() { return offering && offering.kind; }, wake: function () { if (mood.state === 'asleep') wakeUp(); mood.lastTouch = t; },
    nudge: function () { mood.lastTouch = t; },
    setTemper: function (name) { TEMPER.name = name; },
    setSleepAfter: function (sec) { SLEEP_AFTER = sec; },
    setBusy: function (fn) { UIBUSY = fn; },
    get state() { return mood.state; }, get now() { return t; },
    sleep: function () { if (mood.state === 'awake') setMood('asleep'); },
    headTop: function () { return worldToScreen(herToWorld(headPt(V(655, 40)))); },
    // a stroll somewhere else in the garden, now
    wander: function () { if (mood.state === 'awake' && !grab && !wander.goal && !PLACE.busy) wander.next = 0; },
    walkTo: function (wx, wy) { callTo(wx, wy); }, get depth() { return wander.z; },
    setArrange: setArrange, get arranging() { return ARR.on; },
    feet: function () { return { x: herOX(), y: GROUND + wander.z }; },
    // music playing on the phone: she bobs along for as long as a song she likes plays; a song she hates gets a short fit
    music: function (on, likes) {
      if (!on) { if (vibe.until > t) vibe.until = t; if (arms.L.pose === 'vibe') bothArms('down'); return; }
      if (mood.state === 'asleep') setMood('awake');
      if (likes) { vibe.likes = true; vibe.until = t + 1e6; bothArms('vibe'); later(12, function () { if (arms.L.pose === 'vibe') bothArms('down'); }); }
      else { vibe.likes = false; vibe.until = t + 5; mood.flail = t + 0.9; bothArms('flail'); mark('vein', 1.4); later(1, function () { if (arms.L.pose === 'flail') bothArms('crossFront'); later(6, function () { if (arms.L.pose === 'crossFront') bothArms('down'); }); }); }
    },
    activity: setActivity, get activityName() { return activ.name; }, pauseActivity: function (sec) { activ.pause = t + (sec || 90); },
    wear: function (o) { Object.keys(o || {}).forEach(function (k) { if (k in wear) wear[k] = !!o[k]; }); },
    earmuffs: function (on) { extras.muffs = !!on; if (on) { mark('sweat', 1.2); body.sqv += 0.8; } },
    eat: function (img) {
      if (mood.state !== 'awake') setMood('awake');
      extras.food = { img: img, t0: t, dur: 3.4 }; mood.lastTouch = t;
      var p = headPt(V(800, 300)); word(WORDS.munch, V(p.x + 60, p.y), { size: 54, dur: 1.4 });
      later(1.5, function () { var q = headPt(V(520, 300)); word(WORDS.munch, V(q.x - 60, q.y), { size: 50, dur: 1.4 }); });
    },
    perform: perform, get moving() { return moves.queue.length > 0 || t < moves.until; }, moveNames: function () { return Object.keys(MOVES); },
    // the phone itself was shaken: she gets thrown around, and dizzy if it goes on
    jolt: function (ax, ay, strength) {
      if (grab || PLACE.busy) return;
      if (mood.state === 'asleep') wakeUp();
      body.vx += clamp(-ax * 60, -1600, 1600); body.vy += clamp(-ay * 45, -1300, 1300); body.va += clamp(-ax * 0.25, -6, 6) + rnd(-1, 1) * strength;
      mood.lastTouch = t; showFace('boop', 1.2);
    },
    dizzy: function () { showFace('boop', 2.4); var hp = headPt(V(820, 60)); word(WORDS.dizzy, V(hp.x + 30, hp.y)); mark('sweat', 1.4); body.va += rnd(-3, 3); },
    goPlace: goPlace, get place() { return PLACE.name; }, setPlaceNow: function (n) { PLACE.name = n; var off = n === 'house' ? 0 : wander.x; body.x = wander.x = wander.target = off; if (n === 'house') wander.z = wander.tz = 0; },
    get temper() { return TEMPER.name; },
    shake: function (s) { cam.shake = s || 0.3; },
    setHandleRule: function (fn) { HANDLE = fn; }, setSick: function (on) { sickOn = !!on; }, setDream: function (list) { dreamSy = (list || []).slice(0, 4); }
  };
