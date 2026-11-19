'use strict';
  // ===================== BOOT =====================
  window.addEventListener('resize', resize);
  var names = Object.keys(SRC), loaded = 0;
  names.forEach(function (n) {
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      var g = c.getContext('2d'); g.drawImage(im, 0, 0);
      ALPHA[n] = { w: im.width, h: im.height, data: g.getImageData(0, 0, im.width, im.height).data };
      IMG[n] = im;
      if (++loaded === names.length) start();
    };
    im.src = SRC[n];
  });
  var last = 0, acc = 0, DT = 1 / 120;
  function frame(ts) {
    var dt = Math.min(0.05, (ts - (last || ts)) / 1000); last = ts;
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
    draw();
    requestAnimationFrame(frame);
  }
  function start() {
    var ld = document.getElementById('loading'); if (ld) ld.remove();
    try { document.fonts.load('72px "Mochiy Pop One"', 'つんぷにZzz'); document.fonts.load('700 18px Mali'); } catch (e) {}
    resize();
    setMood(mood.state);
    for (var i = 0; i < 240; i++) step(DT);
    requestAnimationFrame(frame);
    UI.start();
    var bp = BRAIN.start();
    if (typeof MIND !== 'undefined') Promise.resolve(bp).catch(function () {}).then(function () { MIND.start(); });
    window.PUSHEEN = {
      arms: arms, head: head, body: body, setPose: setPose, boop: boop, bodyPt: bodyPt, screenOf: worldToScreen, BODY: BODY, BRAIN: BRAIN, SCENE: SCENE, UI: UI, cam: cam,
      hand: function (k, d) { return handW(k, d); }, get fx() { return fx; }, get mood() { return mood.state; }, face: faceName, setMood: setMood,
      setHour: function (h) { SCENE.setHour(h); UI.updateClock(); }
    };
  }
