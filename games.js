'use strict';
  // ===================== GAMES: little brain games that earn points (from CORE), plus a weekly reading topic =====================
  var GAMES = (function () {
    function tr(x) { return UI_TR(x); }
    function mk(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
    function shuf(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function pulse(el, cls) { el.classList.remove('ok', 'ko'); void el.offsetWidth; el.classList.add(cls); }
    var CHEV = { L: 'M15 4 L7 12 L15 20', R: 'M9 4 L17 12 L9 20' };
    function chevron(dir) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + CHEV[dir] + '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }

    // ---------- engine: clock, idle check, quit, results ----------
    function run(def, sec, host, hooks) {
      var root = mk('div', 'gscreen', null, host);
      var top = mk('div', 'gtop', null, root);
      var quit = mk('button', 'btn small', tr('Quit'), top);
      var clock = mk('div', 'gclock', '', top);
      var scoreEl = mk('div', 'gscore', '0', top);
      var prog = mk('div', 'gprog', null, root), progFill = mk('div', null, null, prog);
      var stage = mk('div', 'gstage', null, root);
      var elapsed = 0, last = null, timers = [], lastInput = 0, over = false, raf = 0, quitArmed = 0, paused = false, doneBtn = null;
      var total = sec * 1000;
      var G = {
        stage: stage, hooks: hooks,
        now: function () { return elapsed; },
        after: function (ms, fn) { var t = { at: elapsed + ms, fn: fn }; timers.push(t); return t; },
        touch: function () { lastInput = elapsed; },
        score: function (s) { scoreEl.textContent = s; },
        pause: function (p) { paused = p; },                     // while a reading text is loading
        tap: function (el, fn) { el.addEventListener('pointerdown', function (e) { e.preventDefault(); if (over) return; G.touch(); fn(e); }); },
        over: function () { return over; },
        end: function () { if (!over) finish('done'); }
      };
      function fmt(ms) { var s = Math.ceil(Math.max(0, ms) / 1000); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
      function frame(ts) {
        if (over) return;
        if (last == null) last = ts;
        var dt = Math.min(100, ts - last); last = ts;
        if (!document.hidden && !paused) {
          elapsed += dt;
          for (var i = 0; i < timers.length; i++) if (timers[i].at <= elapsed) { var t = timers.splice(i, 1)[0]; i--; t.fn(); if (over) return; }
          if (def.update) def.update(G, elapsed);
          clock.textContent = fmt(total - elapsed);
          progFill.style.transform = 'scaleX(' + Math.min(1, elapsed / total) + ')';
          if (elapsed >= total) return finish('done');
          if (elapsed - lastInput > def.idle * 1000) return finish('idle');
        } else if (paused) lastInput = elapsed;
        raf = requestAnimationFrame(frame);
      }
      quit.addEventListener('pointerdown', function (e) {
        e.preventDefault(); if (over) return;
        if (Date.now() < quitArmed) return finish('quit');
        quitArmed = Date.now() + 2200; quit.textContent = tr('Tap again');
        setTimeout(function () { if (!over) quit.textContent = tr('Quit'); }, 2200);
      });
      function finish(reason) {
        over = true; cancelAnimationFrame(raf); timers = [];
        var res = def.result(G, sec);
        var pts = reason === 'done' ? hooks.reward(def.id, Math.min(sec, elapsed / 1000), res.perf) : 0;
        stage.innerHTML = ''; top.style.visibility = 'hidden';
        var end = mk('div', 'gend', null, stage);
        mk('div', 'gend-h', reason === 'done' ? tr('Finished!') : reason === 'idle' ? tr('You stopped playing') : tr('Quit'), end);
        mk('div', 'gend-l', res.line, end);
        mk('div', 'gend-r' + (pts ? '' : ' none'), pts ? '+' + pts + ' ✦' : reason === 'done' ? tr('No points left from games today') : tr('No points'), end);
        var done = doneBtn = mk('button', 'btn pinky wide', tr('Done'), end), closed = false;
        done.addEventListener('click', function () { if (closed) return; closed = true; root.remove(); hooks.closed(reason, res, pts); });
      }
      clock.textContent = fmt(total);
      def.start(G);
      raf = requestAnimationFrame(frame);
      return { quit: function () { if (!over) finish('quit'); else if (doneBtn) doneBtn.click(); } };
    }
    function perfOf(x) { return Math.max(0, Math.min(1.5, x)); }

    // ---------- MATH: mental math, faster with every right answer ----------
    var G_MATH = {
      id: 'math', name: 'Math rush', desc: 'Mental math. Each right answer gives you less time.', idle: 30, secs: [30, 60, 120, 300],
      start: function (G) {
        var s = G.s = { lvl: 1, limit: 7000, correct: 0, wrong: 0, input: '', busy: false };
        var box = mk('div', 'm-box', null, G.stage);
        s.q = mk('div', 'm-q', '', box); s.a = mk('div', 'm-a', '', box);
        var bar = mk('div', 'm-bar', null, box); s.bar = mk('div', null, null, bar);
        var pad = mk('div', 'keypad', null, G.stage);
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ''].forEach(function (k) {
          var b = mk('button', 'key' + (k === '' ? ' blank' : ''), k, pad); if (k === '') return;
          G.tap(b, function () { G_MATH.key(G, k); });
        });
        G_MATH.next(G);
      },
      gen: function (lvl) {
        var L = Math.floor(lvl), ops = ['+', '-']; if (L >= 3) ops.push('×'); if (L >= 6) ops.push('÷');
        var op = ops[ri(0, ops.length - 1)], a, b, ans;
        if (op === '+') { a = ri(2, 10 + L * 8); b = ri(2, 10 + L * 8); ans = a + b; }
        else if (op === '-') { a = ri(5, 12 + L * 8); b = ri(1, a); ans = a - b; }
        else if (op === '×') { a = ri(2, Math.min(12, 3 + L)); b = ri(2, 6 + L); ans = a * b; }
        else { b = ri(2, Math.min(12, 2 + L)); ans = ri(2, 5 + L); a = b * ans; }
        return { text: a + ' ' + op + ' ' + b, ans: ans };
      },
      next: function (G) { var s = G.s; s.p = G_MATH.gen(s.lvl); s.input = ''; s.busy = false; s.deadline = G.now() + s.limit; s.q.textContent = s.p.text; s.a.textContent = '_'; s.a.className = 'm-a'; },
      key: function (G, k) {
        var s = G.s; if (s.busy) return;
        if (k === '⌫') s.input = s.input.slice(0, -1); else if (s.input.length < 6) s.input += k;
        s.a.textContent = s.input || '_';
        if (s.input.length >= String(s.p.ans).length) G_MATH.check(G, parseInt(s.input, 10) === s.p.ans);
      },
      check: function (G, right) {
        var s = G.s; s.busy = true;
        if (right) { s.correct++; s.lvl += 0.34; s.limit = Math.max(2200, s.limit * 0.94); pulse(s.a, 'ok'); G.score(s.correct); G.after(220, function () { G_MATH.next(G); }); }
        else { s.wrong++; s.lvl = Math.max(1, s.lvl - 0.5); s.limit = Math.min(8000, s.limit * 1.2); s.a.textContent = s.p.ans; pulse(s.a, 'ko'); G.after(800, function () { G_MATH.next(G); }); }
      },
      update: function (G, t) { var s = G.s; if (!s || s.busy) return; var left = (s.deadline - t) / s.limit; s.bar.style.transform = 'scaleX(' + Math.max(0, left) + ')'; if (left <= 0) G_MATH.check(G, false); },
      result: function (G, sec) { var s = G.s; return { perf: perfOf(s.correct / (sec / 5)), line: s.correct + ' ' + tr('right') + ' · ' + s.wrong + ' ' + tr('missed') }; }
    };

    // ---------- PATTERN: repeat the sequence ----------
    var G_PATTERN = {
      id: 'pattern', name: 'Pattern', desc: 'Watch the cells light up, then repeat them in order.', idle: 30, secs: [30, 60, 120, 300],
      start: function (G) { var s = G.s = { len: 3, flash: 650, size: 0, best: 0, phase: 'wait', seq: [], idx: 0 }; s.info = mk('div', 'g-info', tr('Watch'), G.stage); s.grid = mk('div', 'pgrid', null, G.stage); G.after(500, function () { G_PATTERN.round(G); }); },
      build: function (G, size) {
        var s = G.s; s.size = size; s.grid.innerHTML = ''; s.cells = []; s.grid.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
        for (var i = 0; i < size * size; i++) (function (i) { var c = mk('button', 'cell', null, s.grid); s.cells.push(c); G.tap(c, function () { G_PATTERN.press(G, i); }); })(i);
      },
      light: function (G, i, ms, cls) { var c = G.s.cells[i]; c.classList.add(cls || 'lit'); G.after(ms, function () { c.classList.remove(cls || 'lit'); }); },
      round: function (G) {
        var s = G.s, size = s.len >= 6 ? 4 : 3; if (size !== s.size) G_PATTERN.build(G, size);
        s.seq = []; for (var k = 0; k < s.len; k++) { var c; do { c = ri(0, size * size - 1); } while (k > 0 && c === s.seq[k - 1]); s.seq.push(c); }
        s.phase = 'watch'; s.info.textContent = tr('Watch') + ' · ' + s.len; G.score(s.best);
        var gap = Math.max(120, s.flash * 0.35);
        s.seq.forEach(function (c, k) { G.after(k * (s.flash + gap), function () { G_PATTERN.light(G, c, s.flash); }); });
        G.after(s.len * (s.flash + gap), function () { s.phase = 'input'; s.idx = 0; s.info.textContent = tr('Repeat'); G.touch(); });
      },
      press: function (G, i) {
        var s = G.s; if (s.phase !== 'input') return;
        if (i === s.seq[s.idx]) {
          G_PATTERN.light(G, i, 160); s.idx++;
          if (s.idx === s.len) { s.best = Math.max(s.best, s.len); s.len++; s.flash = Math.max(260, s.flash * 0.9); s.phase = 'wait'; s.info.textContent = tr('Clear!'); pulse(s.info, 'ok'); G.score(s.best); G.after(750, function () { G_PATTERN.round(G); }); }
        } else {
          G_PATTERN.light(G, i, 500, 'bad'); G_PATTERN.light(G, s.seq[s.idx], 500);
          s.len = Math.max(2, s.len - 1); s.flash = Math.min(800, s.flash * 1.1); s.phase = 'wait'; s.info.textContent = tr('Wrong'); pulse(s.info, 'ko');
          G.after(1000, function () { G_PATTERN.round(G); });
        }
      },
      result: function (G) { return { perf: perfOf((G.s.best - 2) / 5), line: tr('Longest sequence') + ' · ' + G.s.best }; }
    };

    // ---------- ARROWS: which way does the middle arrow point? ----------
    var G_ARROWS = {
      id: 'arrows', name: 'Arrows', desc: 'Tap the side the middle arrow points to. Ignore the others.', idle: 30, secs: [30, 60, 120, 300],
      start: function (G) {
        var s = G.s = { limit: 2000, correct: 0, wrong: 0, phase: 'gap' };
        s.info = mk('div', 'g-info', tr('Middle arrow'), G.stage); s.row = mk('div', 'arow', null, G.stage);
        var zones = mk('div', 'azones', null, G.stage), l = mk('button', 'azone', null, zones), r = mk('button', 'azone', null, zones);
        l.innerHTML = chevron('L'); r.innerHTML = chevron('R');
        G.tap(l, function () { G_ARROWS.answer(G, 'L', l); }); G.tap(r, function () { G_ARROWS.answer(G, 'R', r); });
        s.bar = mk('div', 'm-bar', null, G.stage); s.barFill = mk('div', null, null, s.bar);
        G.after(400, function () { G_ARROWS.trial(G); });
      },
      trial: function (G) {
        var s = G.s; s.dir = Math.random() < 0.5 ? 'L' : 'R';
        var flank = Math.random() < 0.5 ? s.dir : (s.dir === 'L' ? 'R' : 'L'), html = '';
        for (var i = 0; i < 5; i++) html += '<span class="' + (i === 2 ? 'mid' : '') + '">' + chevron(i === 2 ? s.dir : flank) + '</span>';
        s.row.innerHTML = html; s.deadline = G.now() + s.limit; s.phase = 'go';
      },
      answer: function (G, side, btn) {
        var s = G.s; if (s.phase !== 'go') return; s.phase = 'gap';
        var right = side === s.dir;
        if (right) { s.correct++; s.limit = Math.max(550, s.limit * 0.95); } else { s.wrong++; s.limit = Math.min(2200, s.limit * 1.15); }
        if (btn) pulse(btn, right ? 'ok' : 'ko'); pulse(s.row, right ? 'ok' : 'ko'); G.score(s.correct);
        G.after(right ? 260 : 600, function () { s.row.innerHTML = ''; G.after(140, function () { G_ARROWS.trial(G); }); });
      },
      update: function (G, t) { var s = G.s; if (!s || s.phase !== 'go') return; var left = (s.deadline - t) / s.limit; s.barFill.style.transform = 'scaleX(' + Math.max(0, left) + ')'; if (left <= 0) G_ARROWS.answer(G, null, null); },
      result: function (G, sec) { var s = G.s; return { perf: perfOf(s.correct / (sec / 1.6)), line: s.correct + ' ' + tr('right') + ' · ' + s.wrong + ' ' + tr('missed') }; }
    };

    // ---------- GRID: tap the numbers in order ----------
    var G_GRID = {
      id: 'grid', name: 'Grid', desc: 'Find and tap every number in order, as fast as you can.', idle: 30, secs: [30, 60, 120, 300],
      start: function (G) { G.s = { size: 5, next: 1, grids: 0, best: null, taps: 0 }; G.s.info = mk('div', 'g-info', tr('Next') + ' · 1', G.stage); G.s.grid = mk('div', 'ngrid', null, G.stage); G_GRID.build(G); },
      build: function (G) {
        var s = G.s; s.size = s.grids >= 2 ? 6 : 5; s.next = 1; s.startAt = G.now();
        s.grid.innerHTML = ''; s.grid.style.gridTemplateColumns = 'repeat(' + s.size + ', 1fr)';
        var nums = []; for (var i = 1; i <= s.size * s.size; i++) nums.push(i);
        shuf(nums).forEach(function (n) { var c = mk('button', 'ncell', String(n), s.grid); G.tap(c, function () { G_GRID.press(G, n, c); }); });
        s.info.textContent = tr('Next') + ' · 1';
      },
      press: function (G, n, c) {
        var s = G.s; if (c.classList.contains('gone')) return;
        if (n !== s.next) { pulse(c, 'ko'); return; }
        c.classList.add('gone'); pulse(c, 'ok'); s.next++; s.taps++;
        if (s.next > s.size * s.size) {
          s.grids++; var t = (G.now() - s.startAt) / 1000; s.best = s.best == null ? t : Math.min(s.best, t);
          s.info.textContent = tr('Grid') + ' ' + s.grids + ' · ' + t.toFixed(1) + ' s'; pulse(s.info, 'ok'); G.score(s.grids);
          G.after(700, function () { G_GRID.build(G); });
        } else s.info.textContent = tr('Next') + ' · ' + s.next;
      },
      result: function (G, sec) { var s = G.s; return { perf: perfOf(s.taps / (sec * 0.8)), line: s.grids + ' ' + tr('grids') + (s.best != null ? ' · ' + tr('best') + ' ' + s.best.toFixed(1) + ' s' : '') }; }
    };

    // ---------- ECHO: n-back on positions ----------
    var G_ECHO = {
      id: 'echo', name: 'Echo', desc: 'Tap Match when a cell lights up in the same place as N steps before.', idle: 40, secs: [60, 120, 300],
      start: function (G) {
        var s = G.s = { n: 1, maxN: 1, interval: 2400, seq: [], hits: 0, misses: 0, falses: 0, trials: 0, good: 0, cur: null };
        s.info = mk('div', 'g-info', '1-back', G.stage);
        s.grid = mk('div', 'pgrid nback', null, G.stage); s.grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        s.cells = []; for (var i = 0; i < 9; i++) s.cells.push(mk('div', 'cell', null, s.grid));
        s.btn = mk('button', 'btn pinky wide match', tr('Match'), G.stage); G.tap(s.btn, function () { G_ECHO.press(G); });
        G.after(800, function () { G_ECHO.step(G); });
      },
      step: function (G) {
        var s = G.s, prev = s.cur;
        if (prev) {
          if (prev.match && !prev.answered) { s.misses++; pulse(s.info, 'ko'); }
          if (!prev.match && !prev.answered) s.good++;
          s.trials++;
          if (s.trials >= 20) { var acc = s.good / s.trials; if (acc >= 0.85 && s.n < 3) s.n++; else if (acc < 0.6 && s.n > 1) s.n--; s.maxN = Math.max(s.maxN, s.n); s.trials = 0; s.good = 0; s.seq = []; s.info.textContent = s.n + '-back'; }
        }
        var L = s.seq.length, pos, match = false;
        if (L >= s.n && Math.random() < 0.33) { pos = s.seq[L - s.n]; match = true; } else { do { pos = ri(0, 8); } while (L >= s.n && pos === s.seq[L - s.n]); }
        s.seq.push(pos); s.cur = { match: match, answered: false };
        var c = s.cells[pos]; c.classList.add('lit'); G.after(500, function () { c.classList.remove('lit'); });
        s.interval = Math.max(1300, s.interval * 0.985); G.after(s.interval, function () { G_ECHO.step(G); });
      },
      press: function (G) { var s = G.s; if (!s.cur || s.cur.answered) return; s.cur.answered = true; if (s.cur.match) { s.hits++; s.good++; pulse(s.btn, 'ok'); } else { s.falses++; pulse(s.btn, 'ko'); } G.score(s.hits); },
      result: function (G, sec) { var s = G.s; return { perf: perfOf((s.hits - s.falses * 0.5) / (sec / 7)), line: s.hits + ' ' + tr('matches') + ' · ' + (s.misses + s.falses) + ' ' + tr('errors') + ' · ' + s.maxN + '-back' }; }
    };

    // ---------- READ: this week's topic — a short text, its questions, then older questions coming back ----------
    var G_READ = {
      id: 'read', name: 'Read', desc: 'One topic per week. Short texts, a quiz after each, and old questions coming back so it sticks.', idle: 180, secs: [120, 300, 600],
      start: function (G) { G.s = { correct: 0, total: 0 }; G_READ.text(G); },
      text: function (G) {
        var s = G.s; G.stage.innerHTML = '';
        var box = mk('div', 'r-box', null, G.stage);
        var tl = mk('div', 'r-topic', G.hooks.study.topicName(), box);
        var title = mk('div', 'r-t', '…', box), body = mk('p', 'r-b', tr('Pusheen is picking the next text…'), box);
        G.pause(true);
        G.hooks.study.next().then(function (t) {
          if (G.over()) return; G.pause(false); G.touch();
          if (!t) return G_READ.review(G, 3, true);                // everything read this week: only review
          s.text = t; title.textContent = t.title; body.textContent = t.body; if (t.again) tl.textContent += ' · ' + tr('again');
          var go = mk('button', 'btn pinky wide', tr("I'm ready"), G.stage);
          G.tap(go, function () { s.queue = t.qs.slice().concat(G.hooks.study.review(2, t.id)); s.qi = 0; G_READ.question(G); });
        });
      },
      review: function (G, n, onlyReview) {
        var s = G.s; s.queue = G.hooks.study.review(n, null); s.qi = 0;
        if (!s.queue.length) { G.stage.innerHTML = ''; mk('div', 'r-box', tr("You've read everything this week. Come back next week for a new topic."), G.stage); var fin = mk('button', 'btn pinky wide', tr('Finish'), G.stage); G.tap(fin, function () { G.end(); }); return; }
        if (onlyReview) { G.stage.innerHTML = ''; mk('div', 'g-info', tr('Review time'), G.stage); G.after(900, function () { G_READ.question(G); }); }
        else G_READ.question(G);
      },
      question: function (G) {
        var s = G.s, q = s.queue[s.qi];
        G.stage.innerHTML = '';
        var box = mk('div', 'r-qbox', null, G.stage);
        mk('div', 'g-info', (q.from ? tr('Coming back') + ' (' + q.from + ') · ' : q.rev ? tr('Review') + ' · ' : '') + tr('Question') + ' ' + (s.qi + 1) + ' / ' + s.queue.length, box);
        mk('div', 'r-q', q.q, box);
        var opts = mk('div', 'r-opts', null, box), answered = false, buttons = [];
        shuf(q.o.map(function (text, k) { return { text: text, right: k === 0 }; })).forEach(function (o) {
          var b = mk('button', 'r-opt', o.text, opts); b.dataset.right = o.right ? '1' : ''; buttons.push(b);
          G.tap(b, function () {
            if (answered) return; answered = true; s.total++;
            if (o.right) { s.correct++; b.classList.add('ok'); } else { b.classList.add('ko'); buttons.forEach(function (x) { if (x.dataset.right) x.classList.add('ok'); }); }
            G.hooks.study.answer(q.id, o.right);
            G.score(s.correct + '/' + s.total);
            G.after(o.right ? 700 : 1600, function () { s.qi++; if (s.qi < s.queue.length) G_READ.question(G); else G_READ.text(G); });
          });
        });
      },
      result: function (G) { var s = G.s; return { perf: s.total ? perfOf(0.4 + s.correct / s.total) : 0, line: s.correct + ' / ' + s.total + ' ' + tr('right') }; }
    };

    return { list: [G_READ, G_MATH, G_PATTERN, G_ARROWS, G_GRID, G_ECHO], run: run };
  })();
