'use strict';
  // ===================== UI: live words + voice, top bar, mood, sheets =====================
  var UI = (function () {
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function hm(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    var tr = typeof LANG !== 'undefined' ? LANG.tr : function (x) { return x; }, JA = typeof LANG !== 'undefined' && LANG.ja;
    function fillT(t, v) { return tr(t).replace(/\{(\w+)\}/g, function (_, k) { return v[k] != null ? v[k] : ''; }); }
    // Japanese: swap every text node and label that has a translation (static markup once, each sheet after it renders)
    function translateDom(root) {
      if (!JA || !root) return;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
      while ((n = w.nextNode())) list.push(n);
      list.forEach(function (t) { var raw = t.nodeValue, k = raw.trim(); if (!k) return; var v = tr(k); if (v !== k) t.nodeValue = raw.replace(k, v); });
      [].forEach.call(root.querySelectorAll('[placeholder],[aria-label],[title]'), function (e) {
        ['placeholder', 'aria-label', 'title'].forEach(function (a) { var v = e.getAttribute(a); if (v && tr(v) !== v) e.setAttribute(a, tr(v)); });
      });
      if (root.getAttribute && root.getAttribute('aria-label')) { var v0 = root.getAttribute('aria-label'); if (tr(v0) !== v0) root.setAttribute('aria-label', tr(v0)); }
    }
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
    function echo(text, pic) {
      var e = $('echo'); e.textContent = ''; e.appendChild(el('b', null, (BRAIN.state.name || 'You') + ':'));
      if (pic) { var im = el('img'); im.src = pic; im.alt = 'your photo'; e.appendChild(im); }
      e.appendChild(document.createTextNode(text || ''));
      e.hidden = false; e.classList.remove('out'); clearTimeout(echoT);
      echoT = setTimeout(function () { e.classList.add('out'); setTimeout(function () { e.hidden = true; }, 600); }, 3500 + text.length * 30);
    }
    var noteT = 0;
    function note(text) { var n = $('note'); n.textContent = tr(text); n.hidden = false; clearTimeout(noteT); noteT = setTimeout(function () { n.hidden = true; }, 9000); n.onclick = function () { n.hidden = true; }; }

    // ---------- chat input + quick actions ----------
    var photo = null;
    function shrinkPhoto(file) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () {
          var im = new Image();
          im.onload = function () {
            var sc = Math.min(1, 1024 / Math.max(im.width, im.height)), c = document.createElement('canvas');
            c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            var dataUrl = c.toDataURL('image/jpeg', 0.82);
            c.toBlob(function (blob) { res({ blob: blob, dataUrl: dataUrl }); }, 'image/jpeg', 0.82);
          };
          im.onerror = function () { rej(new Error('bad image')); }; im.src = fr.result;
        };
        fr.onerror = rej; fr.readAsDataURL(file);
      });
    }
    function attach(file) {
      if (!file) return;
      shrinkPhoto(file).then(function (ph) {
        photo = ph; var a = $('attach'); a.hidden = false; $('attachImg').src = ph.dataUrl; input.placeholder = tr('Add a message, or just send');
      }).catch(function () { toast("That picture couldn't be opened."); });
    }
    function clearPhoto() { photo = null; $('attach').hidden = true; $('attachImg').removeAttribute('src'); input.placeholder = tr('Say something…'); ['camIn', 'picIn'].forEach(function (id) { $(id).value = ''; }); }
    $('camIn').addEventListener('change', function () { attach(this.files && this.files[0]); });
    $('picIn').addEventListener('change', function () { attach(this.files && this.files[0]); });
    $('attachX').addEventListener('click', clearPhoto);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim(); if (!v && !photo) return;
      var ph = photo; input.value = ''; clearPhoto(); BRAIN.hear(v, ph);
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
      else if (a === 'song') { input.value = '♪ '; input.focus(); input.setSelectionRange(2, 2); input.placeholder = tr('song — artist'); }
      else if (a === 'wake') { input.value = tr('Wake me at 07:00'); input.focus(); var at = input.value.indexOf('07:00'); input.setSelectionRange(at, at + 5); }
      else if (a === 'why') BRAIN.hear(tr('Why are you in this mood today?'));
      else if (a === 'game') openSheet('games');
      else if (a === 'cam') $('camIn').click();
      else if (a === 'pic') $('picIn').click();
    });

    // ---------- hold your finger on her: a little ring of things to do ----------
    var HOLD = [['hug', '🤗', 'Hug'], ['pat', '✋', 'Pat'], ['tickle', '🪶', 'Tickle'], ['highfive', '🙌', 'High five'], ['brush', '💇', 'Brush hair'], ['flower', '🌸', 'Flower']];
    function openHold(x, y) {
      var m = $('holdMenu'); m.textContent = ''; m.hidden = false;
      var R = 96, cx = Math.max(R + 40, Math.min(window.innerWidth - R - 40, x)), cy = Math.max(R + 120, Math.min(window.innerHeight - 90, y));
      HOLD.forEach(function (h, i) {
        var a = Math.PI + (i / (HOLD.length - 1)) * Math.PI, b = el('button', 'hbtn doodle press');
        b.style.left = (cx + Math.cos(a) * R - 34) + 'px'; b.style.top = (cy + Math.sin(a) * R - 34) + 'px'; b.style.animationDelay = (i * 25) + 'ms';
        b.appendChild(el('span', 'hi', h[1])); b.appendChild(el('span', 'hl', tr(h[2])));
        b.onclick = function (e) { e.stopPropagation(); closeHold(); BRAIN.interact(h[0]); };
        m.appendChild(b);
      });
      var dot = el('div', 'hdot'); dot.style.left = (cx - 7) + 'px'; dot.style.top = (cy - 7) + 'px'; m.appendChild(dot);
    }
    function closeHold() { $('holdMenu').hidden = true; }
    $('holdMenu').addEventListener('pointerdown', function (e) { if (e.target === this) closeHold(); });

    // ---------- top bar ----------
    var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#5b4944" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.6" fill="#ffe28a"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/></g></svg>';
    var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.4a8.4 8.4 0 1 0 5.2 13.2A7 7 0 0 1 15.5 3.4z" fill="#fff3c4" stroke="#5b4944" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    function updateClock() {
      var h = SCENE.hourNow(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      $('clock').textContent = pad(hh) + ':' + pad(mm); $('clockS').textContent = SCENE.previewing ? '' : ':' + pad(new Date().getSeconds());
      $('clockIcon').innerHTML = h >= 6 && h < 19.2 ? SUN : MOON;
      $('when').textContent = tr(SCENE.previewing ? 'preview' : SCENE.season());
      $('dateTxt').textContent = new Date().toLocaleDateString(JA ? 'ja-JP' : 'en-GB', JA ? { month: 'long', day: 'numeric', weekday: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' });
      var W = BRAIN.weather(), P = BRAIN.place();
      $('wxTxt').textContent = W && P ? ' · ' + W.temp + '° ' + (P.city || '') : '';
    }
    function updateMute() { var m = BRAIN.muted, b = $('muteBtn'); b.classList.toggle('on', m); b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', tr(m ? 'Let her hear your music' : 'Stop her hearing your music')); $('muteTxt').textContent = m ? tr('earmuffs') : ''; }
    $('muteBtn').addEventListener('click', function () { BRAIN.setMuted(!BRAIN.muted); });
    function updatePoints() { $('pts').textContent = BRAIN.state.points; }
    function updateBadge() { var n = BRAIN.open().length, b = $('badge'); b.textContent = n; b.hidden = !n; }
    function updateHouse() {
      var hb = $('houseBtn'), own = !!BRAIN.state.owned.house; hb.hidden = !own;
      var inside = BODY.place === 'house'; hb.classList.toggle('on', inside); hb.setAttribute('aria-label', tr(inside ? 'Go outside' : 'Go inside'));
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
      var f = BRAIN.feelings(), np0 = BRAIN.nowPlaying(), key = f.mood + '|' + f.moodLabel + '|' + f.emotion + '|' + (np0 ? np0.label + np0.verdict : '');
      if (key === lastFeel) return; lastFeel = key;
      var shown = f.sulking ? 'grumpy' : f.mood;
      $('moodcard').dataset.m = shown; $('moodTxt').textContent = tr(f.moodLabel); $('emoTxt').textContent = tr(f.emotion);
      var np = BRAIN.nowPlaying(), npEl = $('npTxt'); npEl.hidden = !np; if (np) npEl.textContent = '♪ ' + np.label + (np.verdict === 'hate' ? tr(' (she hates it)') : '');
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
    var TITLES = { log: 'What we said', missions: 'Missions', shop: 'Shop', notebook: 'Her notebook', settings: 'Settings', games: 'Games' };
    function openSheet(kind) {
      sheetKind = kind; sheet.hidden = false; stitle.textContent = tr(TITLES[kind]);
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
      ({ log: renderLog, missions: renderMissions, shop: renderShop, notebook: renderNotebook, settings: renderSettings, games: renderGames })[sheetKind]();
      translateDom(sbody);
      if (sheetKind !== 'log') sbody.scrollTop = keep;
    }
    function renderLog() {
      var L = BRAIN.state.log;
      if (!L.length) sbody.appendChild(el('p', 'empty', 'Nothing yet. Say hi.'));
      var ul = el('ul', 'loglist');
      L.forEach(function (l) {
        var li = el('li', l.who === 'p' ? 'me' : l.who === 's' ? 'her' + (l.letter ? ' letter' : '') : 'sys');
        if (l.who !== 'n') li.appendChild(el('b', null, (l.who === 'p' ? (BRAIN.state.name || tr('You')) : 'Pusheen') + (l.letter ? tr(' (left you a note)') : '') + ':'));
        li.appendChild(document.createTextNode(l.text)); li.appendChild(el('time', null, hm(l.at)));
        ul.appendChild(li);
      });
      sbody.appendChild(ul);
    }
    var KIND_ICON = { sleep: '☾', tidy: '🧹', move: '👟', food: '🍙', water: '💧', social: '✉', mind: '✧', other: '✦' };
    function dueText(m) {
      if (m.bed) return JA ? m.bedLabel + 'までに寝る' : 'bed by ' + m.bedLabel;
      var d = new Date(m.due), same = new Date().toDateString() === d.toDateString();
      var when = (same ? '' : d.toLocaleDateString(JA ? 'ja-JP' : undefined, { weekday: 'short' }) + ' ') + hm(m.due);
      return JA ? when + 'まで' : 'by ' + when;
    }
    function renderMissions() {
      var S = BRAIN.state, om = BRAIN.open();
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, S.points)); head.appendChild(el('span', null, ' ' + tr('points')));
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
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, S.points)); head.appendChild(el('span', null, ' ' + tr('points to spend')));
      sbody.appendChild(head);
      var tabs = el('div', 'tabs');
      [['garden', 'Garden'], ['house', 'Her house'], ['food', 'Food']].forEach(function (t) {
        var b = el('button', null, t[1]); b.setAttribute('aria-selected', String(shopTab === t[0])); b.onclick = function () { shopTab = t[0]; render(); }; tabs.appendChild(b);
      });
      sbody.appendChild(tabs);
      if (shopTab === 'house' && !S.owned.house) sbody.appendChild(el('p', 'empty', 'She needs a house first. It\'s in the Garden tab.'));
      if (shopTab === 'food') { var hg = BRAIN.hunger(); sbody.appendChild(el('p', 'empty', hg > 0.7 ? 'She hasn\'t eaten in a long time. She\'d never say so.' : hg > 0.35 ? 'She ate a while ago. A snack wouldn\'t hurt.' : 'She ate recently. She can live without food, but she does like it.')); }
      var grid = el('div', 'grid');
      items.filter(function (it) { return it.where === shopTab; }).forEach(function (it) {
        var c = el('div', 'item ' + it.state), cv2 = document.createElement('canvas'); cv2.width = 260; cv2.height = 172;
        c.appendChild(cv2); try { SCENE.icon(it.id, cv2); } catch (e) {}
        c.appendChild(el('div', 'nm', tr(it.name) + (it.max ? ' (' + it.have + '/' + it.max + ')' : '')));
        c.appendChild(el('div', 'ds', it.desc || ''));
        var b = el('button', 'btn ' + (it.state === 'buy' ? 'pinky' : ''), it.state === 'owned' ? 'Hers ✓' : it.state === 'locked' ? fillT('Needs {x}', { x: tr(it.needs === 'house' ? 'the house' : it.needs === 'table' ? 'the table' : 'a bookshelf') }) : it.food ? fillT('Give ✦ {p}', { p: it.price }) : '✦ ' + it.price);
        b.disabled = it.state !== 'buy';
        b.onclick = function () { if (BRAIN.buy(it.id)) { if (it.food) closeSheet(); else { render(); toast(fillT('Bought: {x}', { x: JA ? tr(it.name) : it.name.toLowerCase() })); } } };
        c.appendChild(b); grid.appendChild(c);
      });
      sbody.appendChild(grid);
      sbody.appendChild(el('p', 'foot', 'Earn points with missions and games. The house lets her live inside; then you can furnish it. She especially wants books.'));
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
        var md = el('p', 'today'); md.appendChild(el('span', 'lbl', 'Today: ')); md.appendChild(el('b', null, tr(BRAIN.feelings().moodLabel)));
        md.appendChild(document.createTextNode(JA ? (S.day.reason ? (S.day.revealed ? '。理由：' + S.day.reason + '。' : '。理由はあるけど、まだ言ってない。') : '。特に理由はない。')
          : S.day.reason ? (S.day.revealed ? ', because ' + S.day.reason + '.' : '. There\'s a reason. She hasn\'t said.') : ', for no reason at all.'));
        sbody.appendChild(md);
      }
      var imp = el('div', 'imp');
      imp.appendChild(el('span', 'lbl', 'How she sees you'));
      imp.appendChild(el('strong', null, S.impression ? S.impression.label : 'She hasn\'t decided yet.'));
      if (S.impression && S.impression.note) imp.appendChild(el('p', null, S.impression.note));
      sbody.appendChild(imp);
      sbody.appendChild(el('h3', null, (JA ? '思い出' : 'Souvenirs') + ' (' + S.mem.length + ')'));
      if (!S.mem.length) sbody.appendChild(el('p', 'empty', 'Nothing yet. She decides what is worth keeping.'));
      var ul = el('ul', 'mem');
      S.mem.slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (m) {
        var li = el('li'); li.appendChild(el('time', null, new Date(m.at).toLocaleDateString(JA ? 'ja-JP' : undefined, { day: 'numeric', month: 'short' })));
        li.appendChild(el('span', null, m.text)); if (m.w >= 3) li.classList.add('big'); ul.appendChild(li);
      });
      sbody.appendChild(ul);
      sbody.appendChild(el('p', 'foot', JA ? 'ノートがいっぱいになると書き直します：まとめて、忘れて、大事なことだけ残す。保存先：' + (BRAIN.storage() === 'claude' ? 'あなたのClaudeアカウント（非公開）とこの端末。' : 'この端末。')
        : 'When the notebook gets full she rewrites it: merges, forgets, keeps what matters. Saved ' + (BRAIN.storage() === 'claude' ? 'privately in your Claude account, and on this device.' : 'on this device.')));
    }
    // ---------- little games ----------
    var GICON = { read: ['✎', 'var(--butter)'], math: ['±', 'var(--pink)'], pattern: ['▦', 'var(--mint)'], arrows: ['⇄', 'var(--sky)'], grid: ['#', 'var(--lav)'], echo: ['◉', 'var(--coral)'] };
    var gameHost = null, gameRun = null;
    function durLabel(sec) { return sec < 60 ? sec + (JA ? '秒' : ' s') : (sec / 60) + (JA ? '分' : ' min'); }
    function statSpan(num, label) { var sp = el('span'), tl = tr(label); if (JA && tl.indexOf('{n}') >= 0) { var parts = tl.split('{n}'); sp.appendChild(document.createTextNode(parts[0])); sp.appendChild(el('b', null, String(num))); sp.appendChild(document.createTextNode(parts[1])); return sp; } if (JA) { sp.appendChild(document.createTextNode(tr(label) + ' ')); sp.appendChild(el('b', null, String(num))); } else { sp.appendChild(el('b', null, String(num))); sp.appendChild(document.createTextNode(' ' + label)); } return sp; }
    function renderGames() {
      var gt = BRAIN.games.today(), cap = BRAIN.games.cap, info = BRAIN.study.info();
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, gt.pts + ' / ' + cap)); head.appendChild(el('span', null, ' ' + tr('Points from games today')));
      sbody.appendChild(head);
      GAMES.list.forEach(function (g, i) {
        if (i === 1) sbody.appendChild(el('h3', null, tr('Other games')));
        var c = el('div', 'gcard' + (g.id === 'read' ? ' read' : ''));
        var h = el('h4'), ic = el('span', 'gi', (GICON[g.id] || ['✦'])[0]); ic.style.background = (GICON[g.id] || [0, 'var(--paper)'])[1];
        h.appendChild(ic); h.appendChild(el('span', null, tr(g.name))); c.appendChild(h);
        c.appendChild(el('p', null, tr(g.desc)));
        if (g.id === 'read') {
          var tw = el('div'); tw.appendChild(el('span', 'lbl', tr('This week'))); tw.appendChild(el('div', 'gtopic', info.name)); c.appendChild(tw);
          var stat = el('div', 'gstat');
          stat.appendChild(statSpan(info.read + ' / ' + info.total, 'texts read')); stat.appendChild(statSpan(info.cards, 'questions learned'));
          stat.appendChild(statSpan(info.known, 'known well')); if (info.due) stat.appendChild(statSpan(info.due, 'to review'));
          stat.appendChild(statSpan(info.daysLeft, info.daysLeft === 1 ? 'day left' : 'days left'));
          c.appendChild(stat);
          var mt = el('div', 'gmeter'), mf = el('div'); mf.style.width = Math.round(100 * Math.min(1, info.known / Math.max(6, info.total * 3))) + '%'; mt.appendChild(mf); c.appendChild(mt);
          c.appendChild(el('p', null, tr(info.ai ? 'With a brain connected, she writes new texts on the topic all week (up to 7), so you really get to know it.' : 'Without a brain, the built-in topics come round in turn.')));
          if (info.englishPack) c.appendChild(el('p', null, tr('Built-in texts are in English. Connect a brain (Settings) and she writes them in Japanese.')));
          if (info.ai) {
            var own = el('form', 'gown'), oi = el('input'); oi.placeholder = tr('e.g. the Silk Road, black holes, sushi…'); oi.maxLength = 60; oi.setAttribute('aria-label', tr('Pick your own topic this week'));
            var ob = el('button', 'btn small', tr('Use')); own.appendChild(oi); own.appendChild(ob);
            own.onsubmit = function (e) { e.preventDefault(); if (!oi.value.trim()) return; BRAIN.study.setTopic(oi.value); render(); toast('Saved.'); };
            c.appendChild(field('Pick your own topic this week', own));
            if (info.custom) { var back = el('button', 'btn small', tr('Back to the weekly topic')); back.onclick = function () { BRAIN.study.setTopic(''); render(); }; c.appendChild(back); }
          }
        }
        var d = el('div', 'gdurs');
        g.secs.forEach(function (sec, k) { var b = el('button', 'btn' + (k === (g.id === 'read' ? 1 : 1) ? ' pinky' : ''), durLabel(sec)); b.onclick = function () { startGame(g, sec); }; d.appendChild(b); });
        c.appendChild(d); sbody.appendChild(c);
      });
    }
    function startGame(g, sec) {
      if (gameHost) return;
      closeSheet(); closeQuick(); closeHold();
      gameHost = el('div', 'game'); document.body.appendChild(gameHost);
      VOICE.pause && VOICE.pause();
      gameRun = GAMES.run(g, sec, gameHost, {
        reward: BRAIN.games.reward, study: BRAIN.study,
        closed: function (reason, res, pts) { if (gameHost) gameHost.remove(); gameHost = null; gameRun = null; updatePoints(); BRAIN.games.done(g.id, reason, res, pts); }
      });
    }
    function field(label, inputEl, help) { var w = el('label', 'field'); w.appendChild(el('span', 'lbl', label)); w.appendChild(inputEl); if (help) w.appendChild(el('small', null, help)); return w; }
    function renderSettings() {
      var cfg = BRAIN.getCfg(), st = BRAIN.status(), S = BRAIN.state, vc = VOICE.cfg;
      // language
      sbody.appendChild(el('h3', null, 'Language'));
      var lg = el('select'); [['en', 'English'], ['ja', '日本語']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; lg.appendChild(op); });
      lg.value = JA ? 'ja' : 'en'; lg.onchange = function () { if (lg.value !== (JA ? 'ja' : 'en')) { BRAIN.flushNow && BRAIN.flushNow(); LANG.set(lg.value); } };
      sbody.appendChild(field('App language', lg, 'Her lines, the menus and her AI replies switch language. The page reloads.'));
      // voice
      sbody.appendChild(el('h3', null, 'Her voice'));
      var sw = el('label', 'switch'); sw.appendChild(el('span', null, 'Voice while she talks')); var on = el('input'); on.type = 'checkbox'; on.checked = vc.on; on.onchange = function () { VOICE.set({ on: on.checked }); }; sw.appendChild(on); sbody.appendChild(sw);
      var vol = el('input'); vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.value = vc.vol; vol.oninput = function () { VOICE.set({ vol: +vol.value }); };
      sbody.appendChild(field('Volume', vol));
      var pit = el('input'); pit.type = 'range'; pit.min = 0.8; pit.max = 3; pit.step = 0.05; pit.value = vc.pitch; pit.oninput = function () { VOICE.set({ pitch: +pit.value }); };
      sbody.appendChild(field('Pitch', pit, 'Higher = faster, squeakier loop.'));
      var test = el('button', 'btn', 'Test her voice'); test.type = 'button'; test.onclick = function () { VOICE.unlock(); speak(tr('Hello. ‖ This is my voice. …Is it okay?'), BRAIN.feelings().mood); };
      var fi = el('input'); fi.type = 'file'; fi.accept = 'audio/*';
      fi.onchange = function () { var f = fi.files && fi.files[0]; if (!f) return; if (f.size > 1.5e6) { toast('Pick a shorter sound (under 1.5 MB).'); return; } var r = new FileReader(); r.onload = function () { VOICE.unlock(); VOICE.setSound(r.result); toast('New voice sound loaded.'); render(); }; r.readAsDataURL(f); };
      sbody.appendChild(field('Use my own sound', fi, VOICE.custom ? 'Using your own sound.' : 'Using the built-in blip. A very short sound works best.'));
      var vr = el('div', 'mrow'); vr.appendChild(test);
      if (VOICE.custom) { var rs = el('button', 'btn', 'Back to built-in'); rs.type = 'button'; rs.onclick = function () { VOICE.setSound(null); render(); }; vr.appendChild(rs); }
      sbody.appendChild(vr);
      // music on the phone (app version only)
      var an = BRAIN.android();
      if (an) {
        sbody.appendChild(el('h3', null, 'Your music'));
        var has = false; try { has = an.hasMusicAccess(); } catch (e) {}
        var ms = el('p', 'status ' + (has ? 'on' : 'off')); ms.appendChild(el('i'));
        ms.appendChild(document.createTextNode(has ? 'She can hear what your phone is playing (Spotify, YouTube Music…).' : 'She can\'t hear your music yet.'));
        sbody.appendChild(ms);
        var mb = el('button', 'btn ' + (has ? '' : 'pinky'), has ? 'Change music access' : 'Let her hear your music');
        mb.onclick = function () { try { an.askNotify(); an.openMusicAccess(); } catch (e) {} };
        sbody.appendChild(mb);
        sbody.appendChild(el('p', 'foot', 'Android shows this as "notification access": turn it on for Pusheen. She only reads the song title and artist, nothing else. If she hates a song while you\'re in another app, she may send you a notification about it.'));
      }
      // brain
      sbody.appendChild(el('h3', null, 'Her brain'));
      var s = el('p', 'status ' + (st.kind === 'off' ? 'off' : 'on')); s.appendChild(el('i')); s.appendChild(document.createTextNode(st.text)); sbody.appendChild(s);
      var prov = el('select'); [['auto', 'Automatic'], ['claude', 'Claude (built into this page)'], ['openrouter', 'OpenRouter key'], ['anthropic', 'Anthropic key'], ['off', 'Off (built-in lines only)']]
        .forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; prov.appendChild(op); });
      prov.value = cfg.provider; sbody.appendChild(field('Provider', prov));
      var keyWrap = el('div', 'keyrow'), key = el('input'); key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.placeholder = 'sk-or-… or sk-ant-…'; key.value = cfg.key || '';
      var eye = el('button', 'btn small', 'Show'); eye.type = 'button'; eye.onclick = function () { key.type = key.type === 'password' ? 'text' : 'password'; eye.textContent = tr(key.type === 'password' ? 'Show' : 'Hide'); };
      keyWrap.appendChild(key); keyWrap.appendChild(eye);
      sbody.appendChild(field('API key', keyWrap, 'Paste it here only, never in a chat. It stays on this device: not in her memory, sent only to the provider you pick.'));
      var model = el('input'); model.value = cfg.model || ''; model.spellcheck = false; model.autocomplete = 'off';
      function ph() { model.placeholder = (prov.value === 'anthropic' || /^sk-ant-/.test(key.value)) ? 'claude-sonnet-5-5' : 'openrouter/auto'; }
      ph(); prov.onchange = ph; key.oninput = ph;
      sbody.appendChild(field('Model (optional)', model));
      var vmodel = el('input'); vmodel.value = cfg.visionModel || ''; vmodel.spellcheck = false; vmodel.autocomplete = 'off'; vmodel.placeholder = 'same as above';
      sbody.appendChild(field('Model for photos (optional)', vmodel, 'Only used when you send her a picture. It must be able to see images, e.g. anthropic/claude-haiku-5.5.'));
      var row = el('div', 'mrow');
      var save = el('button', 'btn ok', 'Save'); save.onclick = function () { BRAIN.setCfg({ provider: prov.value, key: key.value.trim(), model: model.value.trim(), visionModel: vmodel.value.trim() }); render(); toast('Saved.'); };
      var rm = el('button', 'btn', 'Remove key'); rm.onclick = function () { BRAIN.setCfg({ key: '' }); render(); toast('Key removed from this device.'); };
      row.appendChild(save); row.appendChild(rm); sbody.appendChild(row);
      sbody.appendChild(el('p', 'foot', 'Inside Claude she thinks with Claude itself (it asks you once), and keys can\'t be used here. Your key is for the app version.'));
      // you
      sbody.appendChild(el('h3', null, 'You'));
      var nm = el('input'); nm.value = S.name || ''; nm.placeholder = 'What should she call you?'; nm.maxLength = 30; nm.onchange = function () { BRAIN.setName(nm.value); };
      sbody.appendChild(field('Your name', nm));
      var wk = el('input'); wk.type = 'time'; wk.value = S.wake || '';
      wk.onchange = function () { BRAIN.setWake(wk.value || null); toast(wk.value ? (JA ? wk.value + 'に起きたか確認します。' : 'She\'ll check you\'re up at ' + wk.value + '.') : 'Wake-up check off.'); };
      var hasAlarm = !!(BRAIN.android() && BRAIN.android().setAlarm);
      sbody.appendChild(field(hasAlarm ? 'Wake-up alarm' : 'Wake-up check', wk, hasAlarm ? 'She rings every day at this time with her voice, and knows if you snooze. Clear it to turn the alarm off.' : 'When you open the app in the morning she compares the time with this. (In the app version she rings like an alarm.)'));
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
      // screen time (app version)
      if (an && an.hasUsageAccess) {
        sbody.appendChild(el('h3', null, 'Screen time'));
        var su = false; try { su = an.hasUsageAccess(); } catch (e) {}
        var sc = BRAIN.screen(), sp = el('p', 'status ' + (su ? 'on' : 'off')); sp.appendChild(el('i'));
        sp.appendChild(document.createTextNode(su ? (sc ? tr('Today: ') + BRAIN.fmtMin(sc.total) + (sc.top && sc.top.length ? ' — ' + sc.top.slice(0, 3).map(function (x) { return x.app + ' ' + BRAIN.fmtMin(x.min); }).join(', ') : '') : 'She can see your screen time.') : 'She can\'t see your screen time yet.'));
        sbody.appendChild(sp);
        var sb = el('button', 'btn ' + (su ? '' : 'pinky'), su ? 'Change screen-time access' : 'Let her see your screen time'); sb.onclick = function () { try { an.openUsageAccess(); } catch (e) {} };
        sbody.appendChild(sb);
        sbody.appendChild(el('p', 'foot', 'Android calls this "usage access". She only sees how long each app was open today. She may give you screen-time missions.'));
      }
      // where you are
      sbody.appendChild(el('h3', null, 'Where you are'));
      var P = BRAIN.place(), W = BRAIN.weather();
      var lp = el('p', 'status ' + (P && P.city ? 'on' : 'off')); lp.appendChild(el('i'));
      lp.appendChild(document.createTextNode(P && P.city ? (JA ? 'いる場所：' : 'She knows you\'re in ') + P.city + (P.country ? ', ' + P.country : '') + (W ? ' (' + W.temp + '°' + (JA ? '' : ', ' + W.desc) + ')' : '') + (JA ? '' : '.') : 'She doesn\'t know where you are.'));
      sbody.appendChild(lp);
      if (navigator.geolocation) {
        var ls = el('label', 'switch'); ls.appendChild(el('span', null, 'Use my location')); var lo = el('input'); lo.type = 'checkbox'; lo.checked = BRAIN.locOn();
        lo.onchange = function () { BRAIN.setLocation(lo.checked).then(function () { render(); }); }; ls.appendChild(lo); sbody.appendChild(ls);
      }
      var city = el('input'); city.placeholder = 'Or type your city'; city.value = P && P.manual ? P.city : ''; city.maxLength = 40;
      city.onchange = function () { BRAIN.setCity(city.value); };
      sbody.appendChild(field('City', city, 'Only the city name is kept. Your position is used to look up the city and the weather (BigDataCloud, Open-Meteo), and is never saved. Weather works in the app version.'));
      // save code
      sbody.appendChild(el('h3', null, 'Save code'));
      sbody.appendChild(el('p', 'foot', 'A code that holds everything: her memories, opinion of you, missions, points, house and furniture. Keep it somewhere safe, or paste it into the other version of Pusheen (Claude ↔ app) to carry her over. Your API key is not in it.'));
      var code = el('textarea', 'codebox'); code.rows = 3; code.placeholder = 'Your save code will appear here. To load one, paste it here.'; code.spellcheck = false;
      var srow = el('div', 'mrow');
      var mk = el('button', 'btn ok', 'Make a save code'); mk.type = 'button';
      mk.onclick = function () { BRAIN.exportCode().then(function (c) { code.value = c; code.focus(); code.select(); try { navigator.clipboard.writeText(c).then(function () { toast('Copied. Keep it somewhere safe.'); }, function () { toast('Select it all and copy it.'); }); } catch (e) { toast('Select it all and copy it.'); } }); };
      var ld = el('button', 'btn', 'Load this code'), armedL = false; ld.type = 'button';
      ld.onclick = function () {
        if (!code.value.trim()) { toast('Paste a save code first.'); return; }
        if (!armedL) { armedL = true; ld.textContent = tr('Tap again: replace her with this save'); setTimeout(function () { armedL = false; ld.textContent = tr('Load this code'); }, 4000); return; }
        BRAIN.importCode(code.value).then(function () { closeSheet(); toast('Loaded.'); }).catch(function (e) { toast((JA ? 'コードが使えませんでした：' : 'That code didn\'t work: ') + (e && e.message || tr('unknown problem'))); });
      };
      srow.appendChild(mk); srow.appendChild(ld); sbody.appendChild(code); sbody.appendChild(srow);
      // memory
      sbody.appendChild(el('h3', null, 'Memory'));
      var forget = el('button', 'btn danger', 'Forget everything'), armed = false;
      forget.onclick = function () {
        if (!armed) { armed = true; forget.textContent = tr('Tap again: she forgets you, missions, points, house'); setTimeout(function () { armed = false; forget.textContent = tr('Forget everything'); }, 4000); return; }
        BRAIN.reset(); closeSheet();
      };
      sbody.appendChild(forget);
    }
    function liveSeason() { var m = new Date().getMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter'; }
    var toastT = 0;
    function toast(t) { var e = $('toast'); e.textContent = tr(t); e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, 2400); }

    // ---------- wiring ----------
    BRAIN.on(function (type, d) {
      if (type === 'say') { speak(d.text, d.mood, d.cut); $('hint').classList.add('gone'); }
      else if (type === 'heard') echo(d.text, d.photo);
      else if (type === 'thinking') thinking(d === true);
      else if (type === 'note') note(d.text);
      else if (type === 'log' && sheetKind === 'log') { render(); sbody.scrollTop = sbody.scrollHeight; }
      else if (type === 'missions') { updateBadge(); if (sheetKind === 'missions') render(); }
      else if (type === 'points') { updatePoints(); var p = $('ptsBtn'); p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); if (sheetKind === 'shop') render(); }
      else if (type === 'owned' || type === 'place') { updateHouse(); if (sheetKind === 'shop') render(); }
      else if (type === 'feel' || type === 'music') updateFeel();
      else if (type === 'muted') updateMute();
      else if (type === 'holdmenu') openHold(d.x, d.y);
      else if (type === 'screen' && sheetKind === 'settings') render();
      else if (type === 'loc') { updateClock(); if (sheetKind === 'settings') render(); }
      else if (type === 'ai' && sheetKind === 'settings') render();
      else if ((type === 'study' || type === 'ai' || type === 'points') && sheetKind === 'games') render();
      else if ((type === 'mem' || type === 'opinion') && sheetKind === 'notebook') render();
      else if (type === 'state') { updatePoints(); updateBadge(); updateHouse(); updateFeel(); updateMute(); }
    });
    var busyCheck = function () { return document.activeElement === input || BRAIN.busy || !sheet.hidden || !!cur || !!gameHost; };
    BODY.setBusy(busyCheck); BRAIN.setBusyCheck(function () { return document.activeElement === input || !sheet.hidden || !!cur || !!gameHost; });

    return {
      start: function () {
        translateDom(document.body);
        updatePoints(); updateBadge(); updateClock(); updateHouse(); updateFeel(); updateMute();
        setInterval(updateClock, 1000); setInterval(updateFeel, 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden && sheetKind === 'settings') render(); });
        requestAnimationFrame(placeSpeech);
        var hint = $('hint'); setTimeout(function () { hint.classList.add('gone'); }, 9000);
        BODY.on(function (type) { if (type === 'touch') hint.classList.add('gone'); if (type === 'place') updateHouse(); });
        // the phone's back button (app version): closes a panel first, and only leaves the app when nothing is open
        window.pusheenBack = function () {
          if (gameRun) { gameRun.quit(); return true; }
          if (!$('holdMenu').hidden) { closeHold(); return true; }
          if (!sheet.hidden) { closeSheet(); return true; }
          if (!drop.hidden) { drop.hidden = true; return true; }
          if (!quick.hidden) { closeQuick(); return true; }
          if (document.activeElement === input) { input.blur(); return true; }
          return false;
        };
      },
      updateClock: updateClock, openSheet: openSheet, speak: speak, voice: VOICE, startGame: startGame, tr: tr
    };
  })();
