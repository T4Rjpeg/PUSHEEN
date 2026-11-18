'use strict';
  // ===================== UI: live words + voice, top bar, mood, sheets =====================
  var UI = (function () {
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function hm(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    var input = $('say'), form = $('sayForm'), quick = $('quick'), speech = $('speech'), stext = $('speechText');
    var sheet = $('sheet'), sbody = $('sbody'), stitle = $('stitle'), drop = $('drop'), sheetKind = null, shopTab = 'garden';

    // ---------- her voice: one short sound looped fast while letters appear, paused whenever the text pauses ----------
    var VOICE = (function () {
      var cfg = Object.assign({ on: true, vol: 0.35, pitch: 1.9 }, lsGet('pusheen.voice') || {});
      var custom = null; try { custom = localStorage.getItem('pusheen.voice.sound'); } catch (e) {}
      var ac = null, gain = null, buf = null, src = null, playing = false, startedAt = 0, offset = 0, curRate = 1, decoding = false;
      function b64ToBuf(b64) { var bin = atob(b64.replace(/^data:[^,]*,/, '')), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
      function decode() {
        if (!ac || decoding) return; decoding = true;
        try {
          ac.decodeAudioData(b64ToBuf(custom || VOICE_WAV), function (b) { buf = b; decoding = false; }, function () { decoding = false; if (custom) { custom = null; decode(); } });
        } catch (e) { decoding = false; }
      }
      function unlock() {
        if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); gain = ac.createGain(); gain.gain.value = 0; gain.connect(ac.destination); } catch (e) { return; } }
        if (ac.state === 'suspended') ac.resume();
        if (!buf) decode();
      }
      function play(rate) {
        if (!cfg.on || !ac || !buf || ac.state !== 'running' || playing) return;
        src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate; src.connect(gain);
        var now = ac.currentTime; gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(cfg.vol, now + 0.006);
        src.start(now, (offset % buf.duration + buf.duration) % buf.duration); startedAt = now; curRate = rate; playing = true;
      }
      function pause() {
        if (!playing || !ac) return;
        var now = ac.currentTime, s = src;
        offset += (now - startedAt) * curRate;                     // remember where the loop was, so it continues from there
        gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + 0.008);
        try { s.stop(now + 0.012); } catch (e) {}
        playing = false;
      }
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, unlock, { passive: true }); });
      return {
        play: play, pause: pause, unlock: unlock, get cfg() { return cfg; },
        set: function (c) { cfg = Object.assign(cfg, c); lsSet('pusheen.voice', cfg); },
        setSound: function (dataUrl) { custom = dataUrl; buf = null; if (dataUrl) { if (!lsSet0('pusheen.voice.sound', dataUrl)) toast('That sound is too big to keep after reload, but it works for now.'); } else { try { localStorage.removeItem('pusheen.voice.sound'); } catch (e) {} } offset = 0; decode(); },
        get custom() { return !!custom; },
        get debug() { return (ac ? ac.state : 'none') + (buf ? ' ready ' + buf.duration.toFixed(3) + 's' : ' no-buffer') + (playing ? ' playing' : ''); }
      };
      function lsSet0(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    })();

    // ---------- her words appear live above her head ----------
    var queue = [], cur = null, holdT = 0, showing = false;
    var SPEED = { sad: 21, dismissive: 25, calm: 30, kind: 33, delighted: 34, grumpy: 37 };
    var PITCH = { sad: 0.86, dismissive: 0.94, calm: 1, kind: 1.08, delighted: 1.12, grumpy: 1.04 };
    function speak(text, mood, cut) {
      // a reaction (she got poked, swung...) interrupts whatever she was saying
      if (cut) { queue = [{ text: text, mood: mood || 'calm' }]; VOICE.pause(); cur = null; nextLine(); return; }
      queue.push({ text: text, mood: mood || 'calm' }); if (queue.length > 3) queue.splice(0, queue.length - 3);
      if (!cur) nextLine();
    }
    function nextLine() {
      clearTimeout(holdT);
      cur = queue.shift();
      if (!cur) { speech.classList.add('out'); holdT = setTimeout(function () { if (!cur) { speech.hidden = true; showing = false; } }, 500); return; }
      speech.hidden = false; speech.classList.remove('out'); showing = true;
      var chars = Array.from(cur.text.replace(/\s*‖\s*/g, '‖')), i = 0, cps = SPEED[cur.mood] || 30, rate = VOICE.cfg.pitch * (PITCH[cur.mood] || 1), line = cur;
      // lay the whole line out first (hidden) so words never jump to the next line while typing
      var shown = el('span'), rest = el('span', 'rest', chars.join('').replace(/‖/g, ' '));
      stext.textContent = ''; stext.appendChild(shown); stext.appendChild(rest);
      var typed = '';
      function put(ch) { typed += ch; shown.textContent = typed; rest.textContent = rest.textContent.slice(ch.length); }
      (function tick() {
        if (line !== cur) return;
        if (i >= chars.length) {
          VOICE.pause();
          var plain = typed.length;
          holdT = setTimeout(nextLine, queue.length ? 900 : 2200 + plain * 45);
          return;
        }
        var ch = chars[i++];
        if (ch === '‖') { VOICE.pause(); put(' '); return setTimeout(tick, 720); }
        put(ch);
        var delay = 1000 / cps, nxt = chars[i];
        if (/[\p{L}\p{N}]/u.test(ch)) VOICE.play(rate);
        if (/[,;:、]/.test(ch)) { VOICE.pause(); delay += 150; }
        else if (/[.!?。！？]/.test(ch) && (nxt === undefined || nxt === ' ' || nxt === '‖')) { VOICE.pause(); delay += 300; }
        else if (ch === '…') { VOICE.pause(); delay += 340; }
        else if (ch === '—' || ch === '–') { VOICE.pause(); delay += 120; }
        setTimeout(tick, delay);
      })();
    }
    function thinking(on) {
      if (on) { if (cur) return; speech.hidden = false; speech.classList.remove('out'); stext.innerHTML = '<span class="dots"><span>·</span><span>·</span><span>·</span></span>'; showing = true; }
      else if (!cur && stext.querySelector('.dots')) { speech.classList.add('out'); setTimeout(function () { if (!cur) speech.hidden = true; }, 450); }
    }
    function placeSpeech() {
      if (!speech.hidden) {
        var p = BODY.headTop(), w = speech.offsetWidth, h = speech.offsetHeight;
        var x = Math.max(12, Math.min(window.innerWidth - w - 12, p.x - w / 2)), y = Math.max(118, p.y - h - 8);
        speech.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
      requestAnimationFrame(placeSpeech);
    }
    var echoT = 0;
    function echo(text) {
      var e = $('echo'); e.textContent = ''; e.appendChild(el('b', null, (BRAIN.state.name || 'You') + ':')); e.appendChild(document.createTextNode(text));
      e.hidden = false; e.classList.remove('out'); clearTimeout(echoT);
      echoT = setTimeout(function () { e.classList.add('out'); setTimeout(function () { e.hidden = true; }, 600); }, 3500 + text.length * 30);
    }
    var noteT = 0;
    function note(text) { var n = $('note'); n.textContent = text; n.hidden = false; clearTimeout(noteT); noteT = setTimeout(function () { n.hidden = true; }, 9000); n.onclick = function () { n.hidden = true; }; }

    // ---------- chat input + quick actions ----------
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim(); if (!v) return;
      input.value = ''; input.placeholder = 'Say something…'; BRAIN.hear(v);
    });
    input.addEventListener('focus', function () { closeQuick(); BODY.nudge(); });
    function closeQuick() { quick.hidden = true; $('plusBtn').setAttribute('aria-expanded', 'false'); }
    $('plusBtn').addEventListener('click', function () { var o = quick.hidden; quick.hidden = !o; this.setAttribute('aria-expanded', String(o)); });
    quick.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      closeQuick();
      var a = b.dataset.a;
      if (a === 'mission') BRAIN.askMission();
      else if (a === 'food') BRAIN.askFood();
      else if (a === 'song') { input.value = '♪ '; input.focus(); input.setSelectionRange(2, 2); input.placeholder = 'song — artist'; }
      else if (a === 'wake') { input.value = 'Wake me at 07:00'; input.focus(); input.setSelectionRange(11, 16); }
      else if (a === 'why') BRAIN.hear('Why are you in this mood today?');
    });

    // ---------- top bar ----------
    var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#5b4944" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.6" fill="#ffe28a"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/></g></svg>';
    var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.4a8.4 8.4 0 1 0 5.2 13.2A7 7 0 0 1 15.5 3.4z" fill="#fff3c4" stroke="#5b4944" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    function updateClock() {
      var h = SCENE.hourNow(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      $('clock').textContent = pad(hh) + ':' + pad(mm);
      $('clockIcon').innerHTML = h >= 6 && h < 19.2 ? SUN : MOON;
      $('when').textContent = SCENE.previewing ? 'preview' : SCENE.season();
    }
    function updatePoints() { $('pts').textContent = BRAIN.state.points; }
    function updateBadge() { var n = BRAIN.open().length, b = $('badge'); b.textContent = n; b.hidden = !n; }
    function updateHouse() {
      var hb = $('houseBtn'), own = !!BRAIN.state.owned.house; hb.hidden = !own;
      var inside = BODY.place === 'house'; hb.classList.toggle('on', inside); hb.setAttribute('aria-label', inside ? 'Go outside' : 'Go inside');
    }
    var FACE = {
      calm: '<path d="M10.5 13.2v1.6M19.5 13.2v1.6"/><path d="M12 20h6"/>',
      kind: '<path d="M9.5 14c.7-1.2 1.9-1.2 2.6 0M18 14c.7-1.2 1.9-1.2 2.6 0"/><path d="M11 18.5c2 2.2 6 2.2 8 0"/><circle cx="8.3" cy="17.3" r="1.2" fill="#ea8fab" stroke="none"/><circle cx="21.7" cy="17.3" r="1.2" fill="#ea8fab" stroke="none"/>',
      delighted: '<path d="M9.5 14c.7-1.2 1.9-1.2 2.6 0M18 14c.7-1.2 1.9-1.2 2.6 0"/><path d="M11 18c1 3 7 3 8 0z" fill="#fff"/>',
      grumpy: '<path d="M9 11.5l3.2 1.4M21 11.5l-3.2 1.4"/><path d="M10.8 14.4v1.2M19.2 14.4v1.2"/><path d="M12 20.5c1.5-1.4 4.5-1.4 6 0"/>',
      sad: '<path d="M9.4 12.4l2.8-1M20.6 12.4l-2.8-1"/><path d="M10.8 14.6v1.2M19.2 14.6v1.2"/><path d="M12 21c1.5-1.6 4.5-1.6 6 0"/>',
      dismissive: '<path d="M9.4 14.6h3.2M17.4 14.6h3.2"/><path d="M13 20h5.5"/>'
    };
    var lastFeel = '';
    function updateFeel() {
      var f = BRAIN.feelings(), key = f.mood + '|' + f.moodLabel + '|' + f.emotion;
      if (key === lastFeel) return; lastFeel = key;
      var shown = f.sulking ? 'grumpy' : f.mood;
      $('moodcard').dataset.m = shown; $('moodTxt').textContent = f.moodLabel; $('emoTxt').textContent = f.emotion;
      $('moodface').innerHTML = '<g fill="none" stroke="#5b4944" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="15" r="12.5" fill="#fffaf0"/>' + (FACE[shown] || FACE.calm) + '</g>';
    }
    $('ptsBtn').addEventListener('click', function () { openSheet('shop'); });
    $('shopBtn').addEventListener('click', function () { openSheet('shop'); });
    $('missionsBtn').addEventListener('click', function () { openSheet('missions'); });
    $('logBtn').addEventListener('click', function () { openSheet('log'); });
    $('houseBtn').addEventListener('click', function () { BRAIN.toggleHouse(); });
    $('menuBtn').addEventListener('click', function (e) {
      e.stopPropagation(); var r = this.getBoundingClientRect();
      drop.style.top = (r.bottom + 8) + 'px'; drop.style.right = Math.max(10, window.innerWidth - r.right) + 'px';
      drop.hidden = !drop.hidden; this.setAttribute('aria-expanded', String(!drop.hidden));
    });
    drop.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; drop.hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); openSheet(b.dataset.s); });
    document.addEventListener('pointerdown', function (e) {
      if (!drop.hidden && !e.target.closest('#drop') && !e.target.closest('#menuBtn')) { drop.hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
      if (!quick.hidden && !e.target.closest('#quick') && !e.target.closest('#plusBtn')) closeQuick();
    });

    // ---------- sheets ----------
    var TITLES = { log: 'What we said', missions: 'Missions', shop: 'Shop', notebook: 'Her notebook', settings: 'Settings' };
    function openSheet(kind) {
      sheetKind = kind; sheet.hidden = false; stitle.textContent = TITLES[kind];
      render();
      if (kind === 'log') sbody.scrollTop = sbody.scrollHeight;
      if (kind === 'notebook' && BODY.state === 'awake' && Math.random() < 0.35) BODY.showFace('fedUp', 1.6);
    }
    function closeSheet() { sheet.hidden = true; sheetKind = null; }
    $('sclose').addEventListener('click', closeSheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); drop.hidden = true; closeQuick(); } });
    function render() {
      if (!sheetKind) return;
      var keep = sbody.scrollTop; sbody.textContent = '';
      ({ log: renderLog, missions: renderMissions, shop: renderShop, notebook: renderNotebook, settings: renderSettings })[sheetKind]();
      if (sheetKind !== 'log') sbody.scrollTop = keep;
    }
    function renderLog() {
      var L = BRAIN.state.log;
      if (!L.length) sbody.appendChild(el('p', 'empty', 'Nothing yet. Say hi.'));
      var ul = el('ul', 'loglist');
      L.forEach(function (l) {
        var li = el('li', l.who === 'p' ? 'me' : l.who === 's' ? 'her' + (l.letter ? ' letter' : '') : 'sys');
        if (l.who !== 'n') li.appendChild(el('b', null, (l.who === 'p' ? (BRAIN.state.name || 'You') : 'Pusheen') + (l.letter ? ' (left you a note)' : '') + ':'));
        li.appendChild(document.createTextNode(l.text)); li.appendChild(el('time', null, hm(l.at)));
        ul.appendChild(li);
      });
      sbody.appendChild(ul);
    }
    var KIND_ICON = { sleep: '☾', tidy: '🧹', move: '👟', food: '🍙', water: '💧', social: '✉', mind: '✧', other: '✦' };
    function dueText(m) {
      if (m.bed) return 'bed by ' + m.bedLabel;
      var d = new Date(m.due), same = new Date().toDateString() === d.toDateString();
      return 'by ' + (same ? '' : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ') + hm(m.due);
    }
    function renderMissions() {
      var S = BRAIN.state, om = BRAIN.open();
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, S.points)); head.appendChild(el('span', null, ' points'));
      sbody.appendChild(head);
      if (!om.length) sbody.appendChild(el('p', 'empty', 'No missions right now. She gives them herself, or you can ask.'));
      om.forEach(function (m) {
        var c = el('div', 'mcard');
        var top = el('div', 'mtop'); top.appendChild(el('span', 'kicon', KIND_ICON[m.kind] || '✦')); top.appendChild(el('p', 'mtext', m.text)); c.appendChild(top);
        var meta = el('div', 'mmeta'); meta.appendChild(el('span', 'pts', '+' + m.pts + ' ✦')); meta.appendChild(el('span', null, dueText(m)));
        if (m.bed) meta.appendChild(el('span', null, 'she checks the clock'));
        c.appendChild(meta);
        var row = el('div', 'mrow');
        if (!m.bed) { var d = el('button', 'btn ok', 'Done!'); d.onclick = function () { BRAIN.complete(m.id); closeSheet(); }; row.appendChild(d); }
        var s = el('button', 'btn', m.bed ? "I won't" : 'Skip'); s.onclick = function () { BRAIN.skip(m.id); closeSheet(); }; row.appendChild(s);
        c.appendChild(row); sbody.appendChild(c);
      });
      var ask = el('button', 'btn pinky wide', om.length >= 3 ? 'Three open: finish one first' : 'Ask her for a mission');
      ask.disabled = om.length >= 3; ask.onclick = function () { closeSheet(); BRAIN.askMission(); };
      sbody.appendChild(ask);
      var past = BRAIN.missions().filter(function (m) { return m.status !== 'open'; }).slice(-6).reverse();
      if (past.length) {
        sbody.appendChild(el('h3', null, 'Lately'));
        var ul = el('ul', 'past');
        past.forEach(function (m) { var li = el('li'); li.appendChild(el('span', 'st ' + m.status, m.caught ? 'caught' : m.status === 'dropped' ? 'taken back' : m.status)); li.appendChild(el('span', null, m.text)); ul.appendChild(li); });
        sbody.appendChild(ul);
      }
      sbody.appendChild(el('p', 'foot', 'Points buy things for her in the shop. They will also connect to CORE later.'));
    }
    function renderShop() {
      var S = BRAIN.state, items = BRAIN.shop();
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, S.points)); head.appendChild(el('span', null, ' points to spend'));
      sbody.appendChild(head);
      var tabs = el('div', 'tabs');
      [['garden', 'Garden'], ['house', 'Her house']].forEach(function (t) {
        var b = el('button', null, t[1]); b.setAttribute('aria-selected', String(shopTab === t[0])); b.onclick = function () { shopTab = t[0]; render(); }; tabs.appendChild(b);
      });
      sbody.appendChild(tabs);
      if (shopTab === 'house' && !S.owned.house) sbody.appendChild(el('p', 'empty', 'She needs a house first. It\'s in the Garden tab.'));
      var grid = el('div', 'grid');
      items.filter(function (it) { return it.where === shopTab; }).forEach(function (it) {
        var c = el('div', 'item ' + it.state), cv2 = document.createElement('canvas'); cv2.width = 260; cv2.height = 172;
        c.appendChild(cv2); try { SCENE.icon(it.id, cv2); } catch (e) {}
        c.appendChild(el('div', 'nm', it.name + (it.max ? ' (' + it.have + '/' + it.max + ')' : '')));
        c.appendChild(el('div', 'ds', it.desc || ''));
        var b = el('button', 'btn ' + (it.state === 'buy' ? 'pinky' : ''), it.state === 'owned' ? 'Hers ✓' : it.state === 'locked' ? 'Needs ' + (it.needs === 'house' ? 'the house' : it.needs === 'table' ? 'the table' : 'a bookshelf') : '✦ ' + it.price);
        b.disabled = it.state !== 'buy';
        b.onclick = function () { if (BRAIN.buy(it.id)) { render(); toast('Bought: ' + it.name.toLowerCase()); } };
        c.appendChild(b); grid.appendChild(c);
      });
      sbody.appendChild(grid);
      sbody.appendChild(el('p', 'foot', 'Earn points with missions. The house lets her live inside; then you can furnish it. She especially wants books.'));
    }
    function renderNotebook() {
      var S = BRAIN.state, L = BRAIN.level();
      var lad = el('div', 'ladder');
      lad.appendChild(el('span', 'lbl', 'What she thinks of you'));
      lad.appendChild(el('div', 'now', L.name));
      if (L.custom) lad.appendChild(el('span', 'soft', 'She named this one herself.'));
      var bar = el('div', 'bar'), fillB = el('div', 'fillbar'); fillB.style.width = Math.max(2, L.value) + '%'; bar.appendChild(fillB);
      for (var i = 0; i < L.count; i++) {
        var seg = el('i', i === L.i ? 'cur' : null, i === L.i ? '★' : '?'); seg.style.flex = String((i + 1 < L.count ? L.starts[i + 1] : 100) - L.starts[i]);
        seg.title = i === L.i ? L.name : '???'; bar.appendChild(seg);
      }
      lad.appendChild(bar);
      var ends = el('div', 'ends'); ends.appendChild(el('span', null, 'hates you')); ends.appendChild(el('span', null, '???')); lad.appendChild(ends);
      sbody.appendChild(lad);
      if (S.day) {
        var md = el('p', 'today'); md.appendChild(el('span', 'lbl', 'Today: ')); md.appendChild(el('b', null, BRAIN.feelings().moodLabel));
        md.appendChild(document.createTextNode(S.day.reason ? (S.day.revealed ? ', because ' + S.day.reason + '.' : '. There\'s a reason. She hasn\'t said.') : ', for no reason at all.'));
        sbody.appendChild(md);
      }
      var imp = el('div', 'imp');
      imp.appendChild(el('span', 'lbl', 'How she sees you'));
      imp.appendChild(el('strong', null, S.impression ? S.impression.label : 'She hasn\'t decided yet.'));
      if (S.impression && S.impression.note) imp.appendChild(el('p', null, S.impression.note));
      sbody.appendChild(imp);
      sbody.appendChild(el('h3', null, 'Souvenirs (' + S.mem.length + ')'));
      if (!S.mem.length) sbody.appendChild(el('p', 'empty', 'Nothing yet. She decides what is worth keeping.'));
      var ul = el('ul', 'mem');
      S.mem.slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (m) {
        var li = el('li'); li.appendChild(el('time', null, new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
        li.appendChild(el('span', null, m.text)); if (m.w >= 3) li.classList.add('big'); ul.appendChild(li);
      });
      sbody.appendChild(ul);
      sbody.appendChild(el('p', 'foot', 'When the notebook gets full she rewrites it: merges, forgets, keeps what matters. Saved ' + (BRAIN.storage() === 'claude' ? 'privately in your Claude account, and on this device.' : 'on this device.')));
    }
    function field(label, inputEl, help) { var w = el('label', 'field'); w.appendChild(el('span', 'lbl', label)); w.appendChild(inputEl); if (help) w.appendChild(el('small', null, help)); return w; }
    function renderSettings() {
      var cfg = BRAIN.getCfg(), st = BRAIN.status(), S = BRAIN.state, vc = VOICE.cfg;
      // voice
      sbody.appendChild(el('h3', null, 'Her voice'));
      var sw = el('label', 'switch'); sw.appendChild(el('span', null, 'Voice while she talks')); var on = el('input'); on.type = 'checkbox'; on.checked = vc.on; on.onchange = function () { VOICE.set({ on: on.checked }); }; sw.appendChild(on); sbody.appendChild(sw);
      var vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = vc.vol; vol.oninput = function () { VOICE.set({ vol: +vol.value }); };
      sbody.appendChild(field('Volume', vol));
      var pit = el('input'); pit.type = 'range'; pit.min = 0.8; pit.max = 3; pit.step = 0.05; pit.value = vc.pitch; pit.oninput = function () { VOICE.set({ pitch: +pit.value }); };
      sbody.appendChild(field('Pitch', pit, 'Higher = faster, squeakier loop.'));
      var test = el('button', 'btn', 'Test her voice'); test.type = 'button'; test.onclick = function () { VOICE.unlock(); speak('Hello. ‖ This is my voice. …Is it okay?', BRAIN.feelings().mood); };
      var fi = el('input'); fi.type = 'file'; fi.accept = 'audio/*';
      fi.onchange = function () { var f = fi.files && fi.files[0]; if (!f) return; if (f.size > 1.5e6) { toast('Pick a shorter sound (under 1.5 MB).'); return; } var r = new FileReader(); r.onload = function () { VOICE.unlock(); VOICE.setSound(r.result); toast('New voice sound loaded.'); render(); }; r.readAsDataURL(f); };
      sbody.appendChild(field('Use my own sound', fi, VOICE.custom ? 'Using your own sound.' : 'Using the built-in blip. A very short sound works best.'));
      var vr = el('div', 'mrow'); vr.appendChild(test);
      if (VOICE.custom) { var rs = el('button', 'btn', 'Back to built-in'); rs.type = 'button'; rs.onclick = function () { VOICE.setSound(null); render(); }; vr.appendChild(rs); }
      sbody.appendChild(vr);
      // brain
      sbody.appendChild(el('h3', null, 'Her brain'));
      var s = el('p', 'status ' + (st.kind === 'off' ? 'off' : 'on')); s.appendChild(el('i')); s.appendChild(document.createTextNode(st.text)); sbody.appendChild(s);
      var prov = el('select'); [['auto', 'Automatic'], ['claude', 'Claude (built into this page)'], ['openrouter', 'OpenRouter key'], ['anthropic', 'Anthropic key'], ['off', 'Off (built-in lines only)']]
        .forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; prov.appendChild(op); });
      prov.value = cfg.provider; sbody.appendChild(field('Provider', prov));
      var keyWrap = el('div', 'keyrow'), key = el('input'); key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.placeholder = 'sk-or-… or sk-ant-…'; key.value = cfg.key || '';
      var eye = el('button', 'btn small', 'Show'); eye.type = 'button'; eye.onclick = function () { key.type = key.type === 'password' ? 'text' : 'password'; eye.textContent = key.type === 'password' ? 'Show' : 'Hide'; };
      keyWrap.appendChild(key); keyWrap.appendChild(eye);
      sbody.appendChild(field('API key', keyWrap, 'Paste it here only, never in a chat. It stays on this device: not in her memory, sent only to the provider you pick.'));
      var model = el('input'); model.value = cfg.model || ''; model.spellcheck = false; model.autocomplete = 'off';
      function ph() { model.placeholder = (prov.value === 'anthropic' || /^sk-ant-/.test(key.value)) ? 'claude-sonnet-5-5' : 'openrouter/auto'; }
      ph(); prov.onchange = ph; key.oninput = ph;
      sbody.appendChild(field('Model (optional)', model));
      var row = el('div', 'mrow');
      var save = el('button', 'btn ok', 'Save'); save.onclick = function () { BRAIN.setCfg({ provider: prov.value, key: key.value.trim(), model: model.value.trim() }); render(); toast('Saved.'); };
      var rm = el('button', 'btn', 'Remove key'); rm.onclick = function () { BRAIN.setCfg({ key: '' }); render(); toast('Key removed from this device.'); };
      row.appendChild(save); row.appendChild(rm); sbody.appendChild(row);
      sbody.appendChild(el('p', 'foot', 'Inside Claude she thinks with Claude itself (it asks you once), and keys can\'t be used here. Your key is for the app version.'));
      // you
      sbody.appendChild(el('h3', null, 'You'));
      var nm = el('input'); nm.value = S.name || ''; nm.placeholder = 'What should she call you?'; nm.maxLength = 30; nm.onchange = function () { BRAIN.setName(nm.value); };
      sbody.appendChild(field('Your name', nm));
      var wk = el('input'); wk.type = 'time'; wk.value = S.wake || '';
      wk.onchange = function () { BRAIN.setWake(wk.value || null); toast(wk.value ? 'She\'ll check you\'re up at ' + wk.value + '.' : 'Wake-up check off.'); };
      sbody.appendChild(field('Wake-up check', wk, 'When you open the app in the morning she compares the time with this.'));
      // preview
      sbody.appendChild(el('h3', null, 'Garden preview'));
      var hr = el('input'); hr.type = 'range'; hr.min = 0; hr.max = 23.9; hr.step = 0.1; hr.value = SCENE.hourNow();
      hr.oninput = function () { SCENE.setHour(+hr.value); updateClock(); };
      sbody.appendChild(field('Time of day', hr));
      var se = el('select'); [['', 'Live (follows the date)'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; se.appendChild(op); });
      se.value = SCENE.previewing && SCENE.season() !== liveSeason() ? SCENE.season() : '';
      se.onchange = function () { SCENE.setSeason(se.value || null); SCENE.invalidate(); updateClock(); };
      sbody.appendChild(field('Season', se));
      var live = el('button', 'btn', 'Back to real time'); live.onclick = function () { SCENE.setHour(null); SCENE.setSeason(null); SCENE.invalidate(); updateClock(); render(); };
      sbody.appendChild(live);
      // memory
      sbody.appendChild(el('h3', null, 'Memory'));
      var forget = el('button', 'btn danger', 'Forget everything'), armed = false;
      forget.onclick = function () {
        if (!armed) { armed = true; forget.textContent = 'Tap again: she forgets you, missions, points, house'; setTimeout(function () { armed = false; forget.textContent = 'Forget everything'; }, 4000); return; }
        BRAIN.reset(); closeSheet();
      };
      sbody.appendChild(forget);
    }
    function liveSeason() { var m = new Date().getMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter'; }
    var toastT = 0;
    function toast(t) { var e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, 2400); }

    // ---------- wiring ----------
    BRAIN.on(function (type, d) {
      if (type === 'say') { speak(d.text, d.mood, d.cut); $('hint').classList.add('gone'); }
      else if (type === 'heard') echo(d.text);
      else if (type === 'thinking') thinking(d === true);
      else if (type === 'note') note(d.text);
      else if (type === 'log' && sheetKind === 'log') { render(); sbody.scrollTop = sbody.scrollHeight; }
      else if (type === 'missions') { updateBadge(); if (sheetKind === 'missions') render(); }
      else if (type === 'points') { updatePoints(); var p = $('ptsBtn'); p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); if (sheetKind === 'shop') render(); }
      else if (type === 'owned' || type === 'place') { updateHouse(); if (sheetKind === 'shop') render(); }
      else if (type === 'feel') updateFeel();
      else if (type === 'ai' && sheetKind === 'settings') render();
      else if ((type === 'mem' || type === 'opinion') && sheetKind === 'notebook') render();
      else if (type === 'state') { updatePoints(); updateBadge(); updateHouse(); updateFeel(); }
    });
    var busyCheck = function () { return document.activeElement === input || BRAIN.busy || !sheet.hidden || !!cur; };
    BODY.setBusy(busyCheck); BRAIN.setBusyCheck(function () { return document.activeElement === input || !sheet.hidden || !!cur; });

    return {
      start: function () {
        updatePoints(); updateBadge(); updateClock(); updateHouse(); updateFeel();
        setInterval(updateClock, 15000); setInterval(updateFeel, 1000);
        requestAnimationFrame(placeSpeech);
        var hint = $('hint'); setTimeout(function () { hint.classList.add('gone'); }, 9000);
        BODY.on(function (type) { if (type === 'touch') hint.classList.add('gone'); if (type === 'place') updateHouse(); });
        // the phone's back button (app version): closes a panel first, and only leaves the app when nothing is open
        window.pusheenBack = function () {
          if (!sheet.hidden) { closeSheet(); return true; }
          if (!drop.hidden) { drop.hidden = true; return true; }
          if (!quick.hidden) { closeQuick(); return true; }
          if (document.activeElement === input) { input.blur(); return true; }
          return false;
        };
      },
      updateClock: updateClock, openSheet: openSheet, speak: speak, voice: VOICE
    };
  })();
