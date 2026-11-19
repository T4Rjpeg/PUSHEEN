'use strict';
  // ===================== DUO: games you play against her (her skill and her reactions follow her mood) =====================
  var DUO = (function () {
    function tr(x) { return UI_TR(x); }
    function mk(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
    function shuf(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function pulse(el, cls) { el.classList.remove('ok', 'ko'); void el.offsetWidth; el.classList.add(cls); }
    // how sloppy she plays: grumpy plays to crush you, kind lets things slide
    var SLOP = { grumpy: 0.05, calm: 0.15, dismissive: 0.28, sad: 0.35, kind: 0.3, delighted: 0.22 };

    // ---------- the shared screen: her face and words on top, the board below ----------
    function run(def, host, hooks) {
      var root = mk('div', 'gscreen duo', null, host);
      var top = mk('div', 'gtop', null, root);
      var quit = mk('button', 'btn small', tr('Quit'), top);
      mk('div', 'dtitle', tr(def.name), top);
      var scoreEl = mk('div', 'gscore', '0 – 0', top);
      var herRow = mk('div', 'dher', null, root), face = mk('img', 'dface', null, herRow), bubble = mk('div', 'dline doodle', '', herRow);
      face.alt = 'Pusheen';
      var stage = mk('div', 'gstage', null, root);
      var timers = [], over = false, faceT = 0;
      var G = {
        stage: stage, hooks: hooks, mood: hooks.mood(), level: hooks.level(),
        slop: function () { return SLOP[G.mood] != null ? SLOP[G.mood] : 0.18; },
        after: function (ms, fn) { var id = setTimeout(function () { if (!over) fn(); }, ms); timers.push(id); return id; },
        face: function (n, sec) { face.src = hooks.face(n); clearTimeout(faceT); if (sec) faceT = setTimeout(function () { if (!over) face.src = hooks.face('main'); }, sec * 1000); },
        her: function (key, v, faceName) { var t = typeof key === 'string' && hooks.hasLine(key) ? hooks.line(key, v) : key; if (!t) return; bubble.textContent = t.replace(/\s*‖\s*/g, ' '); pulse(bubble, 'ok'); hooks.blip(t); if (faceName) G.face(faceName, 3); },
        score: function (a, b) { scoreEl.style.visibility = a === '' ? 'hidden' : ''; scoreEl.textContent = a + ' – ' + b; },
        over: function () { return over; },
        end: function (result, line) { finish(result, line); }
      };
      G.face('main');
      quit.addEventListener('click', function () { if (over) return; finish('quit'); });
      function finish(result, line) {
        over = true; timers.forEach(clearTimeout);
        var pts = result === 'quit' ? 0 : hooks.reward(def.id, result);
        var end = mk('div', 'gend duoend', null, stage.parentNode ? stage : root);
        stage.innerHTML = ''; stage.appendChild(end);
        G.her(line || ({ win: 'duo.lose', lose: 'duo.win', draw: 'duo.draw', quit: 'duo.quit' })[result], null, result === 'win' ? (G.mood === 'grumpy' ? 'fedUp' : 'surprised') : result === 'lose' ? 'happy' : 'content');
        mk('div', 'gend-h', result === 'win' ? tr('You won!') : result === 'lose' ? tr('She won') : result === 'draw' ? tr('Draw') : tr('Quit'), end);
        if (result !== 'quit') mk('div', 'gend-r' + (pts ? '' : ' none'), pts ? '+' + pts + ' ✦' : tr('No points left from games today'), end);
        var row = mk('div', 'gdurs', null, end);
        if (result !== 'quit') { var again = mk('button', 'btn pinky', tr('Rematch'), row); again.onclick = function () { close(result, pts, true); }; }
        var done = mk('button', 'btn', tr('Done'), row); done.onclick = function () { close(result, pts, false); };
        G._done = done;
      }
      var closed = false;
      function close(result, pts, again) { if (closed) return; closed = true; root.remove(); hooks.closed(def.id, result, pts, again); }
      def.start(G);
      return { quit: function () { if (!over) finish('quit'); else if (G._done) G._done.click(); } };
    }

    // ---------- じゃんけん: first to three ----------
    var HANDS = ['✊', '✋', '✌️'], BEATS = [2, 0, 1];   // rock beats scissors, paper beats rock, scissors beat paper
    var JANKEN = {
      id: 'janken', name: 'Janken', desc: 'Rock, paper, scissors. First to three wins.',
      start: function (G) {
        var s = G.s = { you: 0, her: 0, hist: [], busy: false };
        s.show = mk('div', 'jshow', null, G.stage); s.yours = mk('div', 'jhand', '?', s.show); mk('div', 'jvs', 'vs', s.show); s.hers = mk('div', 'jhand', '?', s.show);
        s.info = mk('div', 'g-info', tr('Pick one'), G.stage);
        var row = mk('div', 'jrow', null, G.stage);
        HANDS.forEach(function (h, i) { var b = mk('button', 'jbtn', h, row); b.setAttribute('aria-label', tr(['Rock', 'Paper', 'Scissors'][i])); b.onclick = function () { JANKEN.play(G, i); }; });
        G.her('duo.start');
      },
      pick: function (G) {
        var s = G.s, last = s.hist[s.hist.length - 1], m = G.mood;
        if (last != null && m === 'grumpy' && Math.random() < 0.55) return BEATS.indexOf(last);            // throws what beats your last one
        if (last != null && (m === 'kind' || m === 'delighted') && Math.random() < 0.25) return BEATS[last]; // …or what loses to it
        return ri(0, 2);
      },
      play: function (G, mine) {
        var s = G.s; if (s.busy || G.over()) return; s.busy = true;
        s.yours.textContent = '✊'; s.hers.textContent = '✊'; s.show.classList.add('shake'); s.info.textContent = tr('Jan… ken…');
        var hers = JANKEN.pick(G); s.hist.push(mine);
        G.after(900, function () {
          s.show.classList.remove('shake'); s.info.textContent = tr('Pon!');
          s.yours.textContent = HANDS[mine]; s.hers.textContent = HANDS[hers];
          var r = mine === hers ? 'draw' : BEATS[mine] === hers ? 'win' : 'lose';
          if (r === 'win') { s.you++; pulse(s.yours, 'ok'); G.her('duo.point.you', null, G.mood === 'grumpy' ? 'fedUp' : 'surprised'); }
          else if (r === 'lose') { s.her++; pulse(s.hers, 'ok'); G.her('duo.point.her', null, 'happy'); }
          else G.her('duo.again', null, 'lookLeft');
          G.score(s.you, s.her);
          G.after(1100, function () {
            s.busy = false;
            if (s.you >= 3) G.end('win'); else if (s.her >= 3) G.end('lose'); else s.info.textContent = tr('Pick one');
          });
        });
      }
    };

    // ---------- 三目並べ: tic-tac-toe ----------
    var LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    function win3(b) { for (var i = 0; i < 8; i++) { var l = LINES3[i]; if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return b[l[0]]; } return b.indexOf(null) < 0 ? 'draw' : null; }
    function mm(b, me, turn, depth) {
      var w = win3(b); if (w === me) return 10 - depth; if (w === 'draw') return 0; if (w) return depth - 10;
      var best = turn === me ? -99 : 99;
      for (var i = 0; i < 9; i++) if (!b[i]) { b[i] = turn; var v = mm(b, me, turn === 'X' ? 'O' : 'X', depth + 1); b[i] = null; best = turn === me ? Math.max(best, v) : Math.min(best, v); }
      return best;
    }
    var TICTAC = {
      id: 'tictac', name: 'Tic-tac-toe', desc: 'Three in a row. She plays O.',
      start: function (G) {
        var s = G.s = { b: [null, null, null, null, null, null, null, null, null], busy: false, cells: [] };
        s.info = mk('div', 'g-info', tr('Your turn'), G.stage);
        var grid = mk('div', 'tgrid', null, G.stage);
        for (var i = 0; i < 9; i++) (function (i) { var c = mk('button', 'tcell', '', grid); c.setAttribute('aria-label', String(i + 1)); s.cells.push(c); c.onclick = function () { TICTAC.move(G, i, 'X'); }; })(i);
        G.score('', ''); G.her('duo.start');
        s.herFirst = Math.random() < 0.4; if (s.herFirst) { s.busy = true; s.info.textContent = tr('She goes first'); G.after(900, function () { TICTAC.herMove(G); }); }
      },
      move: function (G, i, who) {
        var s = G.s; if (G.over() || s.b[i] || (who === 'X' && s.busy)) return;
        s.b[i] = who; s.cells[i].textContent = who === 'X' ? '✕' : '◯'; s.cells[i].classList.add(who === 'X' ? 'you' : 'her');
        var w = win3(s.b);
        if (w) { s.busy = true; return G.after(700, function () { G.end(w === 'X' ? 'win' : w === 'O' ? 'lose' : 'draw'); }); }
        if (who === 'X') { s.busy = true; s.info.textContent = tr('She is thinking…'); G.face('lookLeft', 1.2); G.after(ri(600, 1300), function () { TICTAC.herMove(G); }); }
        else { s.busy = false; s.info.textContent = tr('Your turn'); }
      },
      herMove: function (G) {
        var s = G.s, free = [], i;
        for (i = 0; i < 9; i++) if (!s.b[i]) free.push(i);
        var choice;
        if (Math.random() < G.slop()) choice = free[ri(0, free.length - 1)];
        else { var best = -99; free.forEach(function (j) { s.b[j] = 'O'; var v = mm(s.b, 'O', 'X', 0); s.b[j] = null; if (v > best || (v === best && Math.random() < 0.4)) { best = v; choice = j; } }); }
        if (Math.random() < 0.2) G.her('duo.think');
        TICTAC.move(G, choice, 'O');
      }
    };

    // ---------- 四目並べ: connect four ----------
    var R4 = 6, C4 = 7;
    function drop4(b, c, who) { for (var r = R4 - 1; r >= 0; r--) if (!b[r][c]) { b[r][c] = who; return r; } return -1; }
    function win4(b, who) {
      var d = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var r = 0; r < R4; r++) for (var c = 0; c < C4; c++) if (b[r][c] === who)
        for (var k = 0; k < 4; k++) { var n = 1; while (n < 4) { var rr = r + d[k][0] * n, cc = c + d[k][1] * n; if (rr < 0 || rr >= R4 || cc < 0 || cc >= C4 || b[rr][cc] !== who) break; n++; } if (n === 4) return true; }
      return false;
    }
    function full4(b) { return b[0].every(function (x) { return x; }); }
    function score4(b, me) {
      var op = me === 'O' ? 'X' : 'O', sc = 0, d = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var c0 = 0; c0 < R4; c0++) if (b[c0][3] === me) sc += 3;
      for (var r = 0; r < R4; r++) for (var c = 0; c < C4; c++) for (var k = 0; k < 4; k++) {
        var mine = 0, theirs = 0, ok = true;
        for (var n = 0; n < 4; n++) { var rr = r + d[k][0] * n, cc = c + d[k][1] * n; if (rr < 0 || rr >= R4 || cc < 0 || cc >= C4) { ok = false; break; } if (b[rr][cc] === me) mine++; else if (b[rr][cc] === op) theirs++; }
        if (!ok || (mine && theirs)) continue;
        sc += mine === 3 ? 5 : mine === 2 ? 2 : 0; sc -= theirs === 3 ? 6 : theirs === 2 ? 1 : 0;
      }
      return sc;
    }
    function nega(b, depth, a, beta, who) {
      var op = who === 'O' ? 'X' : 'O';
      if (win4(b, op)) return -1000 - depth;
      if (depth === 0 || full4(b)) return score4(b, who);
      var best = -1e9, order = [3, 2, 4, 1, 5, 0, 6];
      for (var i = 0; i < 7; i++) { var c = order[i]; var r = drop4(b, c, who); if (r < 0) continue; var v = -nega(b, depth - 1, -beta, -a, op); b[r][c] = null; if (v > best) best = v; if (v > a) a = v; if (a >= beta) break; }
      return best === -1e9 ? 0 : best;
    }
    var CONNECT = {
      id: 'connect', name: 'Connect four', desc: 'Drop pieces, line up four. She plays pink.',
      start: function (G) {
        var s = G.s = { b: [], busy: false, cells: [] };
        for (var r = 0; r < R4; r++) { s.b.push([]); s.cells.push([]); for (var c = 0; c < C4; c++) s.b[r].push(null); }
        s.info = mk('div', 'g-info', tr('Your turn'), G.stage);
        var grid = mk('div', 'cgrid', null, G.stage);
        for (r = 0; r < R4; r++) for (c = 0; c < C4; c++) (function (r, c) { var cell = mk('button', 'ccell', null, grid); cell.setAttribute('aria-label', tr('Column') + ' ' + (c + 1)); s.cells[r][c] = cell; cell.onclick = function () { CONNECT.move(G, c, 'X'); }; })(r, c);
        G.score('', ''); G.her('duo.start');
      },
      move: function (G, c, who) {
        var s = G.s; if (G.over() || (who === 'X' && s.busy)) return;
        var r = drop4(s.b, c, who); if (r < 0) return;
        s.cells[r][c].classList.add(who === 'X' ? 'you' : 'her', 'fall');
        if (win4(s.b, who)) { s.busy = true; return G.after(800, function () { G.end(who === 'X' ? 'win' : 'lose'); }); }
        if (full4(s.b)) { s.busy = true; return G.after(800, function () { G.end('draw'); }); }
        if (who === 'X') { s.busy = true; s.info.textContent = tr('She is thinking…'); G.face('lookLeft', 1.5); G.after(ri(700, 1400), function () { CONNECT.herMove(G); }); }
        else { s.busy = false; s.info.textContent = tr('Your turn'); }
      },
      herMove: function (G) {
        var s = G.s, legal = [], c;
        for (c = 0; c < C4; c++) if (!s.b[0][c]) legal.push(c);
        // always take a win, and block yours unless she's being sloppy
        for (c = 0; c < legal.length; c++) { var r = drop4(s.b, legal[c], 'O'); var w = win4(s.b, 'O'); s.b[r][legal[c]] = null; if (w) return CONNECT.move(G, legal[c], 'O'); }
        if (Math.random() > G.slop()) for (c = 0; c < legal.length; c++) { var r2 = drop4(s.b, legal[c], 'X'); var w2 = win4(s.b, 'X'); s.b[r2][legal[c]] = null; if (w2) { if (Math.random() < 0.4) G.her('duo.block'); return CONNECT.move(G, legal[c], 'O'); } }
        var pick;
        if (Math.random() < G.slop()) pick = legal[ri(0, legal.length - 1)];
        else { var best = -1e9; legal.forEach(function (cc) { var rr = drop4(s.b, cc, 'O'); var v = -nega(s.b, G.mood === 'grumpy' ? 4 : 3, -1e9, 1e9, 'X') + Math.random() * 0.5; s.b[rr][cc] = null; if (v > best) { best = v; pick = cc; } }); }
        CONNECT.move(G, pick, 'O');
      }
    };

    // ---------- 神経衰弱: memory, taking turns ----------
    var CARDS = ['🍙', '🍡', '🍵', '🍜', '🍰', '🌸', '🍥', '🎐'];
    var MEMORY = {
      id: 'memory', name: 'Memory', desc: 'Take turns flipping two cards. Find a pair, go again. She remembers… sometimes.',
      start: function (G) {
        var s = G.s = { deck: shuf(CARDS.concat(CARDS)), up: [], gone: {}, seen: {}, you: 0, her: 0, turn: 'you', busy: false, cells: [] };
        s.info = mk('div', 'g-info', tr('Your turn'), G.stage);
        var grid = mk('div', 'mgrid', null, G.stage);
        s.deck.forEach(function (sym, i) { var c = mk('button', 'mcard', null, grid); c.setAttribute('aria-label', tr('Card') + ' ' + (i + 1)); s.cells.push(c); c.onclick = function () { if (s.turn === 'you') MEMORY.flip(G, i); }; });
        G.score(0, 0); G.her('duo.start');
        s.recall = { grumpy: 0.9, calm: 0.8, dismissive: 0.55, sad: 0.5, kind: 0.7, delighted: 0.75 }[G.mood] || 0.7;
      },
      flip: function (G, i) {
        var s = G.s; if (G.over() || s.busy || s.gone[i] || s.up.indexOf(i) >= 0) return;
        s.up.push(i); s.cells[i].textContent = s.deck[i]; s.cells[i].classList.add('up');
        if (Math.random() < s.recall) s.seen[i] = s.deck[i];
        if (s.up.length < 2) return;
        s.busy = true;
        var a = s.up[0], b = s.up[1], match = s.deck[a] === s.deck[b];
        G.after(match ? 600 : 1100, function () {
          if (match) {
            s.gone[a] = s.gone[b] = true; s.cells[a].classList.add('gone'); s.cells[b].classList.add('gone'); delete s.seen[a]; delete s.seen[b];
            if (s.turn === 'you') { s.you++; if (Math.random() < 0.3) G.her('duo.point.you'); } else { s.her++; if (Math.random() < 0.4) G.her('duo.point.her', null, 'happy'); }
          } else { [a, b].forEach(function (k) { s.cells[k].textContent = ''; s.cells[k].classList.remove('up'); }); s.turn = s.turn === 'you' ? 'her' : 'you'; }
          s.up = []; G.score(s.you, s.her); s.busy = false;
          if (Object.keys(s.gone).length === s.deck.length) return G.end(s.you > s.her ? 'win' : s.you < s.her ? 'lose' : 'draw');
          if (s.turn === 'her') { s.info.textContent = tr('Her turn'); G.after(700, function () { MEMORY.herTurn(G); }); } else s.info.textContent = tr('Your turn');
        });
      },
      herTurn: function (G) {
        var s = G.s, open = [], i; for (i = 0; i < s.deck.length; i++) if (!s.gone[i]) open.push(i);
        var known = Object.keys(s.seen).map(Number).filter(function (k) { return !s.gone[k]; }), pair = null;
        known.forEach(function (a) { known.forEach(function (b) { if (!pair && a !== b && s.seen[a] === s.seen[b]) pair = [a, b]; }); });
        var first = pair ? pair[0] : (open.filter(function (k) { return s.seen[k] == null; })[0] != null ? shuf(open.filter(function (k) { return s.seen[k] == null; }))[0] : open[ri(0, open.length - 1)]);
        MEMORY.flipHer(G, first);
        G.after(800, function () {
          var second = pair ? pair[1] : null;
          if (second == null) { var m = known.filter(function (k) { return k !== first && s.seen[k] === s.deck[first]; })[0]; second = m != null ? m : shuf(open.filter(function (k) { return k !== first; }))[0]; }
          MEMORY.flipHer(G, second);
        });
      },
      flipHer: function (G, i) { var s = G.s; s.busy = false; var t = s.turn; s.turn = 'her'; MEMORY.flip(G, i); s.turn = t; }
    };

    // ---------- しりとり / word chain (needs her brain) ----------
    var CHAIN = {
      id: 'chain', name: 'Word chain', desc: 'Each word starts with the end of the last one. No repeats. She checks your words.', needsBrain: true,
      start: function (G) {
        var s = G.s = { words: [], busy: false, you: 0, her: 0 };
        s.list = mk('div', 'wlist', null, G.stage);
        s.info = mk('div', 'g-info', tr('She starts'), G.stage);
        var f = mk('form', 'wform', null, G.stage); s.inp = mk('input', null, null, f); s.inp.maxLength = 30; s.inp.setAttribute('aria-label', tr('Your word')); s.inp.placeholder = tr('Your word');
        var b = mk('button', 'btn pinky small', tr('Send'), f);
        f.onsubmit = function (e) { e.preventDefault(); CHAIN.yours(G); };
        G.score(0, 0); G.her('duo.start'); s.busy = true; CHAIN.ask(G, null);
      },
      add: function (G, who, w) { var s = G.s; s.words.push(w); var r = mk('div', 'wrow ' + who, null, s.list); mk('span', null, w, r); s.list.scrollTop = 1e6; },
      yours: function (G) {
        var s = G.s, w = s.inp.value.trim(); if (!w || s.busy || G.over()) return;
        s.inp.value = ''; s.busy = true; CHAIN.add(G, 'you', w); s.info.textContent = tr('She is thinking…'); G.face('lookLeft', 2);
        CHAIN.ask(G, w);
      },
      ask: function (G, w) {
        var s = G.s;
        G.hooks.chain(s.words.slice(0, w ? -1 : undefined), w).then(function (r) {
          if (G.over()) return;
          if (w && r.valid === false) { G.her(r.say || r.why || 'duo.chainBad', null, 'happy'); return G.after(1800, function () { G.end('lose'); }); }
          if (w) s.you++;
          if (r.give_up || !r.word) { G.her(r.say || 'duo.chainGiveUp', null, 'fedUp'); return G.after(1800, function () { G.end('win'); }); }
          CHAIN.add(G, 'her', r.word + (r.reading && r.reading !== r.word ? '（' + r.reading + '）' : '')); s.her++;
          if (r.say) G.her(r.say);
          if (r.ends_game) return G.after(1800, function () { G.end('win'); });
          G.score(s.you, s.her); s.busy = false; s.info.textContent = tr('Your turn'); s.inp.focus();
        }, function () { if (!G.over()) { G.her('duo.chainError', null, 'down'); G.after(2000, function () { G.end('draw'); }); } });
      }
    };

    return { list: [JANKEN, TICTAC, CONNECT, MEMORY, CHAIN], run: run };
  })();
