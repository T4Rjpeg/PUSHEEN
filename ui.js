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
      var ac = null, gain = null, buf = null, src = null, playing = false, startedAt = 0, offset = 0, curRate = 1, decoding = false, duck = 1;
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
        if (!cfg.on || !ac || !buf || ac.state !== 'running' || playing || duck <= 0) return;
        src = ac.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate; src.connect(gain);
        var now = ac.currentTime; gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(cfg.vol * duck, now + 0.006);
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
        get custom() { return !!custom; }, setDuck: function (f) { duck = f; if (f <= 0) pause(); },
        get debug() { return (ac ? ac.state : 'none') + (buf ? ' ready ' + buf.duration.toFixed(3) + 's' : ' no-buffer') + (playing ? ' playing' : ''); }
      };
      function lsSet0(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    })();

    // ---------- her words appear live above her head ----------
    var queue = [], cur = null, holdT = 0, showing = false;
    var SPEED = { sad: 21, dismissive: 25, calm: 30, kind: 33, delighted: 34, grumpy: 37 };
    var PITCH = { sad: 0.86, dismissive: 0.94, calm: 1, kind: 1.08, delighted: 1.12, grumpy: 1.04 };
    function speak(text, mood, cut, parts) {
      // a reaction (she got poked, swung...) interrupts whatever she was saying
      if (cut) { queue = [{ text: text, mood: mood || 'calm' }]; VOICE.pause(); cur = null; nextLine(); return; }
      queue.push({ text: text, mood: mood || 'calm', part: parts > 1 });
      // keep every piece of a long answer; only older one-liners get dropped when too much piles up
      while (queue.length > 3 + queue.filter(function (q) { return q.part; }).length) { var drop = queue.findIndex(function (q) { return !q.part; }); if (drop < 0) break; queue.splice(drop, 1); }
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
          holdT = setTimeout(nextLine, queue.length ? (line.part ? 1300 + plain * 18 : 900) : 2200 + plain * 45);
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
    // ---------- hold the mic and talk to her ----------
    var MIC = { on: false, text: '', d: null, rec: null, kind: null };
    (function () {
      var mic = $('micBtn'), an = BRAIN.android(), lang = JA ? 'ja-JP' : (navigator.language || 'en-US');
      var WSR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (an && an.listen) MIC.kind = 'android'; else if (WSR) MIC.kind = 'web';
      if (window.claude && claude.use) claude.use('dictation').then(function (d) { if (d && !MIC.kind) { MIC.d = d; MIC.kind = 'claude'; mic.hidden = false;
        d.onPartial(function (r) { if (MIC.on) input.value = MIC.text + r.text; }); d.onFinal(function (r) { MIC.text += r.text + ' '; input.value = MIC.text; }); } }).catch(function () {});
      mic.hidden = !MIC.kind;
      window.pusheenHeard = function (text, done, err) {
        if (err === 'permission') { toast('Allow the microphone, then hold the button again.'); stopUI(); return; }
        if (err && !MIC.text && !text) { if (MIC.on) toast('I didn\'t catch that.'); stopUI(); return; }
        if (text) input.value = text;
        if (done) { MIC.text = text || input.value; finish(); }
      };
      function startUI() { MIC.on = true; MIC.text = ''; input.value = ''; mic.classList.add('listening'); input.placeholder = tr('Listening…'); BODY.perform(['tilt_left']); BODY.wake(); }
      function stopUI() { MIC.on = false; mic.classList.remove('listening'); input.placeholder = tr('Say something…'); }
      function finish() { var t = (input.value || MIC.text || '').trim(); stopUI(); if (t) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); }
      mic.addEventListener('pointerdown', function (e) {
        e.preventDefault(); if (MIC.on) return; closeQuick();
        if (MIC.kind === 'claude' && MIC.d) { MIC.d.start().catch(function (er) { stopUI(); if (er && er.code === 'not_granted') { mic.hidden = true; } }); startUI(); return; }
        startUI();
        if (MIC.kind === 'android') { try { an.listen(lang); } catch (x) { stopUI(); } }
        else if (MIC.kind === 'web') {
          try { var r = MIC.rec = new WSR(); r.lang = lang; r.interimResults = true; r.continuous = true;
            r.onresult = function (ev) { var fin = '', part = ''; for (var i = 0; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript) : (part += ev.results[i][0].transcript)); MIC.text = fin; input.value = fin + part; };
            r.onerror = function () { stopUI(); }; r.onend = function () { if (MIC.on) finish(); }; r.start(); } catch (x) { stopUI(); }
        }
      });
      function release() {
        if (!MIC.on) return;
        if (MIC.kind === 'android') { try { an.stopListen(); } catch (x) {} setTimeout(function () { if (MIC.on) finish(); }, 2500); }
        else if (MIC.kind === 'web' && MIC.rec) { try { MIC.rec.stop(); } catch (x) { finish(); } }
        else if (MIC.kind === 'claude' && MIC.d) MIC.d.stop().then(finish, finish);
      }
      mic.addEventListener('pointerup', release); mic.addEventListener('pointercancel', release); mic.addEventListener('pointerleave', function () { if (MIC.on) release(); });
    })();
    window.pusheenPerm = function () { if (sheetKind === 'settings' && !sheet.hidden) render(); BRAIN.refreshSenses && BRAIN.refreshSenses(); };
    // ---------- her face and last words on your home screen (phone app widget) ----------
    var widgetT = 0, widgetLast = '';
    function pushWidget() {
      var an = BRAIN.android(); if (!an || !an.setWidget) return;
      var L = BRAIN.state.log.filter(function (l) { return l.who === 's'; }).pop(), text = L ? L.text.slice(0, 120) : '…';
      var tm = BRAIN.feelings().mood, face = BODY.state === 'asleep' ? 'sleep' : { delighted: 'happy', kind: 'content', grumpy: 'fedUp', sad: 'lookDown', dismissive: 'lookLeft' }[tm] || 'main';
      var key = face + '|' + text; if (key === widgetLast) return; widgetLast = key;
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = 220; var g = c.getContext('2d');
        g.fillStyle = '#fde3eb'; g.beginPath(); g.arc(110, 110, 104, 0, Math.PI * 2); g.fill();
        var sc = Math.min(200 / im.width, 200 / im.height); g.drawImage(im, 110 - im.width * sc / 2, 112 - im.height * sc / 2, im.width * sc, im.height * sc);
        try { an.setWidget(c.toDataURL('image/png'), text); } catch (e) {}
      };
      im.src = SRC['face_' + face] || SRC.face_main;
    }
    function widgetSoon() { clearTimeout(widgetT); widgetT = setTimeout(pushWidget, 2500); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) pushWidget(); });
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
    drop.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; drop.hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false');
      if (b.dataset.s === 'arrange') return arrange(true);
      openSheet(b.dataset.s);
    });
    // ---------- arranging the garden: drag her things anywhere on the floor ----------
    var arrBar = null;
    function arrange(on) {
      if (on && BODY.place !== 'garden') { toast(JA ? '庭にいるときだけ並べ替えられます。' : 'Only in the garden. Bring her outside first.'); return; }
      BODY.setArrange(on);
      if (on && !arrBar) {
        arrBar = el('div', 'arrbar doodle');
        arrBar.appendChild(el('span', null, JA ? '物をドラッグして好きな場所へ' : 'Drag her things anywhere on the ground'));
        var reset = el('button', 'btn small', JA ? '元に戻す' : 'Put back'); reset.type = 'button';
        reset.onclick = function () { SCENE.resetLayout(); BRAIN.setLayout({}); toast(JA ? '元の場所に戻しました。' : 'Everything is back where it was.'); };
        var done = el('button', 'btn ok small', JA ? '完了' : 'Done'); done.type = 'button'; done.onclick = function () { arrange(false); };
        arrBar.appendChild(reset); arrBar.appendChild(done); document.body.appendChild(arrBar);
      }
      if (arrBar) arrBar.hidden = !on;
      document.body.classList.toggle('arranging', !!on);
    }
    document.addEventListener('pointerdown', function (e) {
      if (!drop.hidden && !e.target.closest('#drop') && !e.target.closest('#menuBtn')) { drop.hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
      if (!quick.hidden && !e.target.closest('#quick') && !e.target.closest('#plusBtn')) closeQuick();
    });

    // ---------- sheets ----------
    var TITLES = { log: 'What we said', missions: 'Missions', shop: 'Shop', notebook: 'Her notebook', settings: 'Settings', games: 'Games', mail: 'Mail' };
    function openSheet(kind) {
      if (sheetKind !== kind) sbody.scrollTop = 0;
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
      ({ log: renderLog, missions: renderMissions, shop: renderShop, notebook: renderNotebook, settings: renderSettings, games: renderGames, mail: renderMail })[sheetKind]();
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
        li.appendChild(document.createTextNode(l.text));
        if (l.photo && typeof MIND !== 'undefined') { var src = MIND.albumImg(l.photo); if (src) { var im0 = el('img', 'lp'); im0.src = src; im0.alt = ''; im0.onclick = function () { showPolaroid(src, l.text); }; li.appendChild(im0); } }
        li.appendChild(el('time', null, hm(l.at)));
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
      if (typeof MIND !== 'undefined') renderMindBits();
      var imp = el('div', 'imp');
      imp.appendChild(el('span', 'lbl', 'How she sees you'));
      imp.appendChild(el('strong', null, S.impression ? S.impression.label : 'She hasn\'t decided yet.'));
      if (S.impression && S.impression.note) imp.appendChild(el('p', null, S.impression.note));
      sbody.appendChild(imp);
      // her diary
      var dia = BRAIN.diary();
      sbody.appendChild(el('h3', null, tr('Her diary') + (dia.length ? ' (' + dia.length + ')' : '')));
      if (!BRAIN.diaryOpen()) sbody.appendChild(el('p', 'empty', tr(dia.length ? 'She keeps it closed. Maybe when she trusts you more.' : 'She writes in it at night.')));
      else if (!dia.length) sbody.appendChild(el('p', 'empty', tr('She writes in it at night.')));
      else { var dl2 = el('ul', 'mem diary'); dia.slice(0, 14).forEach(function (d) { var li = el('li'); li.appendChild(el('time', null, new Date(d.day + 'T12:00:00').toLocaleDateString(JA ? 'ja-JP' : undefined, { weekday: 'short', day: 'numeric', month: 'short' }))); li.appendChild(el('span', null, d.text)); dl2.appendChild(li); }); sbody.appendChild(dl2); }
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
    // ---------- she holds something out: take it or not ----------
    var OFFER_UI = { hug: ['🤗', 'Hug her', 'She holds out her arms'], highfive: ['🙌', 'High five', 'She holds up her hand'], pat: ['✋', 'Pat her head', 'She tilts her head toward you'],
                     hand: ['🤝', 'Take her hand', 'She holds out her hand'], pinky: ['🤙', 'Pinky promise', 'She holds out her little finger'], play: ['✿', 'Play', 'She wants to play'] };
    function showOffer(d) {
      var box = $('offer');
      if (!d) { box.hidden = true; return; }
      var o = OFFER_UI[d.kind]; if (!o) return;
      var gd = d.kind === 'play' && DUO.list.filter(function (x) { return x.id === d.game; })[0];
      $('offerTxt').textContent = tr(o[2]) + (gd ? ': ' + tr(gd.name) : ''); $('offerYes').textContent = o[0] + ' ' + tr(o[1]); $('offerNo').textContent = tr('Not now');
      box.hidden = false; buzzOnce();
    }
    function buzzOnce() { try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} }
    $('offerYes').onclick = function () { $('offer').hidden = true; BRAIN.answerOffer(true); };
    $('offerNo').onclick = function () { $('offer').hidden = true; BRAIN.answerOffer(false); };

    // ---------- little games ----------
    var GICON = { read: ['✎', 'var(--butter)'], math: ['±', 'var(--pink)'], pattern: ['▦', 'var(--mint)'], arrows: ['⇄', 'var(--sky)'], grid: ['#', 'var(--lav)'], echo: ['◉', 'var(--coral)'] };
    var gameHost = null, gameRun = null;
    function durLabel(sec) { return sec < 60 ? sec + (JA ? '秒' : ' s') : (sec / 60) + (JA ? '分' : ' min'); }
    function statSpan(num, label) { var sp = el('span'), tl = tr(label); if (JA && tl.indexOf('{n}') >= 0) { var parts = tl.split('{n}'); sp.appendChild(document.createTextNode(parts[0])); sp.appendChild(el('b', null, String(num))); sp.appendChild(document.createTextNode(parts[1])); return sp; } if (JA) { sp.appendChild(document.createTextNode(tr(label) + ' ')); sp.appendChild(el('b', null, String(num))); } else { sp.appendChild(el('b', null, String(num))); sp.appendChild(document.createTextNode(' ' + label)); } return sp; }
    // ---------- her savings, what she noticed, her photos (in the notebook) ----------
    function renderMindBits() {
      var gi = MIND.goal(), pts = BRAIN.state.points;
      if (gi) {
        var gc = el('div', 'goalcard'); gc.appendChild(el('span', 'lbl', 'Saving up for'));
        gc.appendChild(el('div', 'gn', gi.name)); gc.appendChild(el('p', 'soft', gi.why));
        var mt = el('div', 'gmeter'), mf = el('div'); mf.style.width = Math.round(100 * gi.saved / gi.price) + '%'; mt.appendChild(mf); gc.appendChild(mt);
        var r2 = el('div', 'row2'); r2.appendChild(el('b', null, '✦ ' + gi.saved + ' / ' + gi.price));
        [5, 10, 25].forEach(function (n) { var b = el('button', 'btn small', fillT('Give ✦ {p}', { p: n })); b.disabled = pts < n; b.onclick = function () { if (MIND.helpGoal(n)) { toast('Thank you.'); render(); } }; r2.appendChild(b); });
        gc.appendChild(r2); gc.appendChild(el('small', 'soft', 'She saves a little from every mission you finish and every game you play. You can chip in.'));
        sbody.appendChild(gc);
      }
      var mine = MIND.goals().filter(function (g) { return g.owned; });
      if (mine.length) sbody.appendChild(el('p', 'soft', tr('Bought with her own savings: ') + mine.map(function (g) { return g.name; }).join(', ')));
      var hb = MIND.habits();
      if (hb.length) { sbody.appendChild(el('h3', null, 'What she noticed about you')); var ul = el('ul', 'mem habits'); hb.forEach(function (h) { ul.appendChild(el('li', null, h)); }); sbody.appendChild(ul); }
      var cat = MIND.cat(); if (cat && cat.fed) sbody.appendChild(el('p', 'soft', (cat.name ? cat.name : tr('The stray cat')) + ' · ' + fillT('fed {n} times', { n: cat.fed })));
      var al = MIND.album();
      if (al.length) { sbody.appendChild(el('h3', null, tr('Her photos') + ' (' + al.length + ')')); sbody.appendChild(thumbs(al)); }
      var wl = MIND.wall();
      if (wl.length) { sbody.appendChild(el('h3', null, tr('On her wall') + ' (' + wl.length + ')')); sbody.appendChild(thumbs(wl)); }
    }
    function thumbs(list) {
      var g = el('div', 'thumbs');
      list.forEach(function (p) { var b = el('button'), im = el('img'); im.src = p.img; im.alt = p.cap || ''; b.appendChild(im); b.onclick = function () { showPolaroid(p.img, p.cap || ''); }; g.appendChild(b); });
      return g;
    }
    var polT = 0;
    function showPolaroid(src, cap) {
      var pd = $('polaroid'); $('polImg').src = src; $('polCap').textContent = String(cap || '').replace(/\s*‖\s*/g, ' '); pd.hidden = false;
      clearTimeout(polT); polT = setTimeout(function () { pd.hidden = true; }, 8000);
    }
    $('polaroid').addEventListener('click', function () { $('polaroid').hidden = true; });
    // ---------- mail: her letters, postcards from your trips, and yours ----------
    function renderMail() {
      var form = el('form', 'letter'), ta = el('textarea'); ta.placeholder = tr('Dear Pusheen,'); ta.maxLength = 3000;
      form.appendChild(field('Write to her', ta, 'She answers by letter, about a day later.'));
      var send = el('button', 'btn pinky wide', tr('Send the letter')); form.appendChild(send);
      form.onsubmit = function (e) { e.preventDefault(); if (MIND.writeLetter(ta.value)) { ta.value = ''; toast('Sent.'); render(); } else toast('Write a little more.'); };
      sbody.appendChild(form);
      var list = MIND.mail();
      if (!list.length) sbody.appendChild(el('p', 'empty', 'The mailbox is empty.'));
      list.forEach(function (m) {
        var card = el('div', 'mailitem ' + m.kind + (m.read ? '' : ' unread')), mh = el('div', 'mh');
        mh.appendChild(el('b', null, m.kind === 'mine' ? tr('You → Pusheen') : m.kind === 'letter' ? tr('Pusheen → you') : fillT('Postcard from {city}', { city: m.city })));
        mh.appendChild(el('span', null, new Date(m.kind === 'mine' ? m.at : m.deliver).toLocaleDateString(JA ? 'ja-JP' : undefined, { day: 'numeric', month: 'short' })));
        card.appendChild(mh);
        if (m.kind === 'postcard') { var cv = document.createElement('canvas'); cv.width = 640; cv.height = 410; drawPostcard(cv, m); card.appendChild(cv); }
        card.appendChild(el('p', 'mt', m.text || '…'));
        sbody.appendChild(card);
        if (!m.read) MIND.readMail(m.id, true);
      });
      updateMailBadge();
    }
    function drawPostcard(cv, m) {
      var g = cv.getContext('2d'), W = cv.width, H = cv.height, ink = '#5b4944', R0 = function (n) { var x = Math.sin(n * 999 + m.city.length) * 1e4; return x - Math.floor(x); };
      g.fillStyle = '#fffaf0'; g.fillRect(0, 0, W, H);
      var sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#c4e5f5'); sky.addColorStop(1, '#fde3eb'); g.fillStyle = sky; g.fillRect(18, 18, W - 36, H - 36);
      g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 5; g.strokeStyle = ink;
      var mo = m.motif, base = H - 110;
      g.beginPath();
      if (mo === 'mountain') { g.moveTo(40, base); g.lineTo(230, 110); g.lineTo(420, base); g.closePath(); g.fillStyle = '#aebbe1'; g.fill(); g.stroke(); g.beginPath(); g.moveTo(185, 160); g.lineTo(230, 110); g.lineTo(275, 160); g.lineTo(250, 150); g.lineTo(230, 170); g.lineTo(210, 150); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.stroke(); }
      else if (mo === 'sea') { for (var k = 0; k < 4; k++) { g.beginPath(); for (var x = 30; x < W - 30; x += 40) g.quadraticCurveTo(x + 10, base - 60 + k * 26 - 18, x + 20, base - 60 + k * 26); g.stroke(); } g.beginPath(); g.arc(W - 150, 120, 46, 0, 7); g.fillStyle = '#ffe08a'; g.fill(); g.stroke(); }
      else if (mo === 'tower') { g.moveTo(W / 2 - 70, base); g.lineTo(W / 2 - 14, 90); g.lineTo(W / 2 + 14, 90); g.lineTo(W / 2 + 70, base); g.closePath(); g.fillStyle = '#f6c9a8'; g.fill(); g.stroke(); for (var y = 130; y < base; y += 40) { g.beginPath(); g.moveTo(W / 2 - 20 - (y - 90) * 0.18, y); g.lineTo(W / 2 + 20 + (y - 90) * 0.18, y); g.stroke(); } }
      else if (mo === 'bridge') { g.moveTo(30, base - 40); g.quadraticCurveTo(W / 2, base - 210, W - 30, base - 40); g.stroke(); g.beginPath(); g.rect(30, base - 50, W - 60, 20); g.fillStyle = '#ee8a63'; g.fill(); g.stroke(); for (var bx = 80; bx < W - 60; bx += 60) { g.beginPath(); g.moveTo(bx, base - 50); g.lineTo(bx, base - 50 - Math.sin((bx - 30) / (W - 60) * Math.PI) * 140); g.stroke(); } }
      else if (mo === 'temple') { g.moveTo(170, 160); g.lineTo(470, 160); g.lineTo(430, 120); g.lineTo(210, 120); g.closePath(); g.fillStyle = '#a0b1dd'; g.fill(); g.stroke(); g.beginPath(); g.rect(210, 160, 220, base - 160); g.fillStyle = '#fbeedd'; g.fill(); g.stroke(); g.beginPath(); g.rect(290, base - 90, 60, 90); g.fillStyle = '#d8ae86'; g.fill(); g.stroke(); }
      else if (mo === 'castle') { g.rect(160, 150, 320, base - 150); g.fillStyle = '#e6dccd'; g.fill(); g.stroke(); for (var cx2 = 160; cx2 < 480; cx2 += 64) { g.beginPath(); g.rect(cx2, 120, 32, 30); g.fill(); g.stroke(); } g.beginPath(); g.arc(320, base, 40, Math.PI, 0); g.fillStyle = '#b98c66'; g.fill(); g.stroke(); }
      else if (mo === 'bread') { g.ellipse(W / 2, base - 70, 170, 70, 0, 0, 7); g.fillStyle = '#e8b96a'; g.fill(); g.stroke(); for (var kk = -2; kk <= 2; kk++) { g.beginPath(); g.moveTo(W / 2 + kk * 56 - 20, base - 110); g.lineTo(W / 2 + kk * 56 + 20, base - 40); g.stroke(); } }
      else { for (var f = 0; f < 6; f++) { var fx = 90 + f * 90, fy = base - 40 - R0(f) * 120; g.beginPath(); g.moveTo(fx, base); g.lineTo(fx, fy); g.stroke(); for (var pe = 0; pe < 5; pe++) { g.beginPath(); g.ellipse(fx + Math.cos(pe * 1.256) * 18, fy + Math.sin(pe * 1.256) * 18, 14, 9, pe * 1.256, 0, 7); g.fillStyle = ['#f8c4d3', '#ffe08a', '#d7c7f5'][f % 3]; g.fill(); g.stroke(); } } }
      g.fillStyle = '#c3e3a6'; g.fillRect(18, base, W - 36, H - 18 - base); g.beginPath(); g.moveTo(18, base); g.lineTo(W - 18, base); g.stroke();
      g.font = '40px "Mochiy Pop One", "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.lineWidth = 9; g.strokeStyle = '#fffaf0';
      var title = fillT('Greetings from {city}', { city: m.city }); g.strokeText(title, 40, H - 44); g.fillStyle = ink; g.fillText(title, 40, H - 44);
      g.save(); g.translate(W - 110, 40); g.rotate(0.06); g.fillStyle = '#fff'; g.strokeStyle = ink; g.lineWidth = 4; g.setLineDash([6, 5]); g.strokeRect(0, 0, 80, 96); g.setLineDash([]); g.fillRect(4, 4, 72, 88);
      g.fillStyle = '#f39ab6'; g.beginPath(); g.moveTo(40, 72); g.bezierCurveTo(6, 48, 22, 18, 40, 38); g.bezierCurveTo(58, 18, 74, 48, 40, 72); g.fill(); g.restore();
      g.strokeStyle = 'rgba(91,73,68,0.55)'; g.lineWidth = 3; g.beginPath(); g.arc(W - 150, 120, 44, 0, 7); g.stroke();
      g.font = '700 14px Mali, sans-serif'; g.fillStyle = 'rgba(91,73,68,0.7)'; g.textAlign = 'center'; g.fillText(new Date(m.deliver).toLocaleDateString(JA ? 'ja-JP' : 'en-GB', { day: 'numeric', month: 'short' }), W - 150, 125);
      g.strokeStyle = ink; g.lineWidth = 5; g.strokeRect(18, 18, W - 36, H - 36);
    }
    function updateMailBadge() { if (typeof MIND === 'undefined') return; var n = MIND.unread(), b = $('mailBadge'); b.hidden = !n; b.textContent = n; }
    // ---------- studying together ----------
    function updateFocus() {
      if (typeof MIND === 'undefined') return;
      var f = MIND.focus(), ch = $('focusChip');
      ch.hidden = !f; if (!f) return;
      var s0 = Math.ceil(f.left / 1000); $('focusTxt').textContent = Math.floor(s0 / 60) + ':' + (s0 % 60 < 10 ? '0' : '') + (s0 % 60);
    }
    $('focusStop').addEventListener('click', function () { if (typeof MIND !== 'undefined') MIND.stopFocus(); updateFocus(); });
    function renderFocusCard() {
      var c = el('div', 'gcard read'), h = el('h4'), ic = el('span', 'gi', '📖'); ic.style.background = 'var(--mint)';
      h.appendChild(ic); h.appendChild(el('span', null, tr('Study with her'))); c.appendChild(h);
      c.appendChild(el('p', null, tr('A focus timer. She studies at her desk with you, and notices if you sneak off to other apps.')));
      var f = MIND.focus(), d = el('div', 'gdurs');
      if (f) { var stop = el('button', 'btn', tr('Stop')); stop.onclick = function () { MIND.stopFocus(); render(); }; d.appendChild(el('b', null, fillT('{n} min left', { n: Math.ceil(f.left / 60000) }))); d.appendChild(stop); }
      else [15, 25, 45, 60].forEach(function (m2, k) { var b = el('button', 'btn' + (k === 1 ? ' pinky' : ''), m2 + (JA ? '分' : ' min')); b.onclick = function () { MIND.startFocus(m2); closeSheet(); updateFocus(); }; d.appendChild(b); });
      c.appendChild(d); sbody.appendChild(c);
    }
    function renderGames() {
      if (typeof MIND !== 'undefined') renderFocusCard();
      var gt = BRAIN.games.today(), cap = BRAIN.games.cap, info = BRAIN.study.info();
      var head = el('div', 'ptsline'); head.appendChild(el('span', null, '✦')); head.appendChild(el('strong', null, gt.pts + ' / ' + cap)); head.appendChild(el('span', null, ' ' + tr('Points from games today')));
      sbody.appendChild(head);
      // games against her
      sbody.appendChild(el('h3', null, tr('Play with her')));
      var stats = BRAIN.duo.stats(), dl = el('div', 'duolist');
      DUO.list.forEach(function (g) {
        var c = el('div', 'gcard'), h = el('h4'), ic = el('span', 'gi', { janken: '✊', tictac: '◯', connect: '●', memory: '🍙', chain: 'あ' }[g.id] || '✦'); ic.style.background = 'var(--paper-2)';
        h.appendChild(ic); h.appendChild(el('span', null, tr(g.name)));
        var st = stats[g.id]; if (st) h.appendChild(el('span', 'grec', (JA ? '' : '') + st.w + '–' + st.l + (st.d ? '–' + st.d : '')));
        c.appendChild(h); c.appendChild(el('p', null, tr(g.desc)));
        var off = g.needsBrain && BRAIN.kind() === 'off';
        if (off) c.appendChild(el('p', null, tr('Needs her brain (Settings).')));
        var b = el('button', 'btn pinky small', tr('Play')); b.disabled = off; b.onclick = function () { startDuo(g); };
        c.appendChild(b); dl.appendChild(c);
      });
      sbody.appendChild(dl);
      sbody.appendChild(el('h3', null, tr('Games')));
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
    function blip(text) {
      var n = String(text || '').replace(/[^\p{L}\p{N}]/gu, '').length; if (!n || !VOICE.cfg.on) return;
      VOICE.play(VOICE.cfg.pitch); setTimeout(function () { VOICE.pause(); }, Math.min(1400, 60 + n * 32));
    }
    function startDuo(g, fromHer) {
      if (gameHost) return;
      if (!fromHer) { var can = BRAIN.duo.can(g.id); if (!can.ok) { closeSheet(); if (can.line) BRAIN.sayNow(can.line, 'away'); return; } }
      closeSheet(); closeQuick(); closeHold();
      gameHost = el('div', 'game'); document.body.appendChild(gameHost);
      gameRun = DUO.run(g, gameHost, {
        mood: BRAIN.duo.mood, level: BRAIN.duo.level, face: function (n) { return SRC['face_' + n] || SRC.face_main; },
        hasLine: BRAIN.duo.has, line: BRAIN.duo.line, blip: blip, reward: BRAIN.duo.reward, chain: BRAIN.duo.chain,
        closed: function (id, result, pts, again) { if (gameHost) gameHost.remove(); gameHost = null; gameRun = null; updatePoints(); BRAIN.duo.done(id, result, pts, again); if (again) setTimeout(function () { startDuo(g, true); }, 50); }
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
      if (st.kind !== 'off' && BRAIN.bankInfo) {
        var bi = BRAIN.bankInfo(), bp = el('p', 'foot');
        bp.textContent = bi.n ? (JA ? '新しいセリフ ' + bi.n + '個（' + hm(bi.at) + 'に作成）。なくなると自分で書き直します。' : bi.n + ' fresh lines ready (written ' + hm(bi.at) + '). She writes new ones as they run out, or when her mood changes.') : (JA ? 'まだ新しいセリフがありません。すぐ書きます。' : 'No fresh lines yet: she\'ll write some in a moment.');
        sbody.appendChild(bp);
      }
      var aerr = BRAIN.aiError && BRAIN.aiError();
      if (aerr) {
        var ep = el('p', 'foot'); ep.style.color = 'var(--warn, #b5562b)';
        ep.textContent = (JA ? '最後の問題 ' : 'Last problem ') + hm(aerr.at) + ': ' + aerr.code + (aerr.msg ? ' — ' + aerr.msg.slice(0, 140) : '');
        sbody.appendChild(ep);
      }
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
      // her head over other apps (app version)
      if (an && an.canOverlay && typeof MIND !== 'undefined') {
        sbody.appendChild(el('h3', null, 'Floating head'));
        var co = false; try { co = an.canOverlay(); } catch (e) {}
        var ov = MIND.overlay(), op = el('p', 'status ' + (co && ov.on ? 'on' : 'off')); op.appendChild(el('i'));
        op.appendChild(document.createTextNode(tr(co ? 'She can float over other apps.' : 'She can peek out over other apps when you have been scrolling one for too long.'))); sbody.appendChild(op);
        if (!co) { var ob = el('button', 'btn pinky', 'Let her float over other apps'); ob.onclick = function () { try { an.openOverlay(); } catch (e) {} }; sbody.appendChild(ob); }
        var osel = el('select'); [[0, tr('Off')], [20, '20' + (JA ? '分' : ' min')], [30, '30' + (JA ? '分' : ' min')], [45, '45' + (JA ? '分' : ' min')], [60, '60' + (JA ? '分' : ' min')]].forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; osel.appendChild(x); });
        osel.value = ov.on ? String(ov.min) : '0';
        osel.onchange = function () { var v = +osel.value; MIND.setOverlay(v ? { on: true, min: v } : { on: false }); if (v && !co) try { an.openOverlay(); } catch (e) {} render(); };
        sbody.appendChild(field('Peek after', osel, 'Only for scrolling apps (social media, videos, games). It also needs screen-time access.'));
      }
      // where you are
      sbody.appendChild(el('h3', null, 'Where you are'));
      var P = BRAIN.place(), W = BRAIN.weather();
      var lp = el('p', 'status ' + (P && P.city ? 'on' : 'off')); lp.appendChild(el('i'));
      var addr = P && P.city ? [BRAIN.placeNow() ? '★ ' + BRAIN.placeNow() : '', P.street, P.spot, P.area, P.city + (P.country ? ', ' + P.country : '')].filter(Boolean).join(', ') : '';
      lp.appendChild(document.createTextNode(P && P.city ? (JA ? 'いる場所：' : 'She knows you\'re at: ') + addr + (W ? ' (' + W.temp + '°' + (JA ? '' : ', ' + W.desc) + ')' : '') : 'She doesn\'t know where you are.'));
      sbody.appendChild(lp);
      // naming the place you're at
      if (P && P.lat != null && !P.manual) {
        var nameRow = el('div', 'mrow');
        [['home', '🏠', 'Home'], ['school', '🏫', 'School'], ['work', '💼', 'Work'], ['gym', '🏃', 'Gym']].forEach(function (k) {
          var b = el('button', 'btn small', k[1] + ' ' + tr(k[2])); b.type = 'button'; b.onclick = function () { if (BRAIN.addPlace(tr(k[2]), k[0])) { toast(fillT('Saved: {x}', { x: tr(k[2]) })); render(); } }; nameRow.appendChild(b);
        });
        var other = el('input'); other.placeholder = tr('Another name'); other.maxLength = 30; other.style.maxWidth = '150px';
        var ob = el('button', 'btn small', '＋'); ob.type = 'button'; ob.onclick = function () { if (other.value.trim() && BRAIN.addPlace(other.value.trim(), 'other')) { toast(fillT('Saved: {x}', { x: other.value.trim() })); render(); } };
        nameRow.appendChild(other); nameRow.appendChild(ob);
        sbody.appendChild(field('Name the place you are at now', nameRow, 'She will know when you are there, when you arrive and when you leave.'));
      }
      var PL = BRAIN.places();
      if (PL.length) {
        var pul = el('ul', 'plist');
        PL.forEach(function (pl) { var li = el('li'); li.appendChild(el('span', 'ic', { home: '🏠', school: '🏫', work: '💼', gym: '🏃' }[pl.kind] || '📍')); li.appendChild(el('span', 'nm', pl.name)); var x = el('button', 'btn small', '✕'); x.type = 'button'; x.setAttribute('aria-label', tr('Forget this place')); x.onclick = function () { BRAIN.removePlace(pl.id); render(); }; li.appendChild(x); pul.appendChild(li); });
        sbody.appendChild(pul);
      }
      var anL = BRAIN.android();
      if (anL && anL.hasPerm) {
        var bgOk = anL.hasPerm('bgLocation');
        var bgp = el('p', 'status ' + (bgOk ? 'on' : 'off')); bgp.appendChild(el('i')); bgp.appendChild(document.createTextNode(tr(bgOk ? 'She notices arrivals even when the app is closed.' : 'She only knows where you are while the app is open.'))); sbody.appendChild(bgp);
        if (!bgOk) { var bgb = el('button', 'btn', tr('Let her notice arrivals in the background')); bgb.type = 'button'; bgb.onclick = function () { anL.askPerm('bgLocation'); }; sbody.appendChild(bgb);
          sbody.appendChild(el('p', 'foot', 'Android shows this as location "Allow all the time". It is only used for the places you named.')); }
      }
      if (navigator.geolocation) {
        var ls = el('label', 'switch'); ls.appendChild(el('span', null, 'Use my location')); var lo = el('input'); lo.type = 'checkbox'; lo.checked = BRAIN.locOn();
        lo.onchange = function () { BRAIN.setLocation(lo.checked).then(function () { render(); }); }; ls.appendChild(lo); sbody.appendChild(ls);
      }
      var city = el('input'); city.placeholder = 'Or type your city'; city.value = P && P.manual ? P.city : ''; city.maxLength = 40;
      city.onchange = function () { BRAIN.setCity(city.value); };
      sbody.appendChild(field('City', city, 'Your exact position stays on this device (and in your save code). Her brain only gets the street, the area and your named places, never the coordinates. Addresses come from OpenStreetMap, weather from Open-Meteo; both work in the app version.'));
      // her senses (phone app)
      var anS = BRAIN.android();
      if (anS && anS.hasPerm) {
        sbody.appendChild(el('h3', null, 'Her senses'));
        var musicOn = false, usageOn = false; try { musicOn = anS.hasMusicAccess(); usageOn = anS.hasUsageAccess(); } catch (e) {}
        [['activity', 'Steps', 'She counts your steps and ticks off walking missions herself.', anS.hasPerm('activity') && anS.hasPerm('steps')],
         ['calendar', 'Calendar', 'She sees your events (titles and times), wishes you luck and asks how it went.', anS.hasPerm('calendar')],
         ['mic', 'Microphone', 'Hold the mic button to talk to her out loud. She only listens while you hold it.', anS.hasPerm('mic')],
         ['music', 'Unread notifications', 'Uses the same access as your music: she counts unread notifications per app, never what they say.', musicOn],
         ['usage', 'Real sleep', 'Uses screen-time access: from when your screen went dark at night, she knows when you actually slept.', usageOn]].forEach(function (r) {
          var row = el('div', 'sense'), st = el('p', 'status ' + (r[3] ? 'on' : 'off')); st.appendChild(el('i')); var tx = el('span'); tx.appendChild(el('b', null, tr(r[1]))); tx.appendChild(document.createTextNode(' — ' + tr(r[2]))); st.appendChild(tx); row.appendChild(st);
          if (!r[3]) { var b = el('button', 'btn small', tr('Allow')); b.type = 'button'; b.onclick = function () { if (r[0] === 'music') anS.openMusicAccess(); else if (r[0] === 'usage') anS.openUsageAccess(); else anS.askPerm(r[0]); }; row.appendChild(b); }
          sbody.appendChild(row);
        });
        sbody.appendChild(el('p', 'foot', 'Battery, headphones and phone calls need no permission: she gets sleepy on low battery, talks softly with headphones in, and goes quiet during calls. Add the "Pusheen" widget from your home screen to keep her there.'));
      }
      // save: everything, as a file (with her photos) or a code to paste
      sbody.appendChild(el('h3', null, 'Save'));
      sbody.appendChild(el('p', 'foot', JA ? 'セーブには全部入ります：記憶、あなたへの気持ち、ミッション、ポイント、持ち物と庭の配置、日記、そしてこの端末の設定（頭脳の種類とモデル、声、言語、位置情報、フローティング）。ファイルには写真も入ります。APIキーは絶対に入りません。新しい端末ではもう一度貼ってください。' :
        'A save holds everything: her memories, what she thinks of you, missions, points, everything she owns and where it stands, her diary, and this device\'s settings (brain and model, voice, language, location, floating head). Files also keep her photos. Your API key is never in it: paste it again on a new device.'));
      var frow = el('div', 'mrow');
      var sf = el('button', 'btn ok', JA ? 'ファイルに保存' : 'Save to a file'); sf.type = 'button';
      sf.onclick = function () {
        sf.disabled = true;
        BRAIN.exportCode(true).then(function (c) { return saveText('pusheen-save-' + new Date().toISOString().slice(0, 10) + '.txt', c); })
          .then(function (where) { toast(where ? (JA ? '保存しました：' : 'Saved: ') + where : (JA ? '保存しました。' : 'Saved.')); })
          .catch(function (e) { toast((JA ? '保存できませんでした：' : 'Couldn\'t save: ') + (e && e.message || tr('unknown problem'))); })
          .then(function () { sf.disabled = false; });
      };
      var lf = el('button', 'btn', JA ? 'ファイルから読み込む' : 'Load a file'); lf.type = 'button';
      var fin = document.createElement('input'); fin.type = 'file'; fin.accept = '.txt,.pusheen,text/plain'; fin.hidden = true;
      fin.onchange = function () {
        var f = fin.files && fin.files[0]; fin.value = ''; if (!f) return;
        if (f.size > 12e6) { toast(JA ? 'ファイルが大きすぎます。' : 'That file is too big to be a save.'); return; }
        var rd = new FileReader();
        rd.onload = function () { loadSave(String(rd.result || '')); };
        rd.onerror = function () { toast(JA ? '読み込めませんでした。' : 'Couldn\'t read that file.'); };
        rd.readAsText(f);
      };
      lf.onclick = function () { fin.click(); };
      frow.appendChild(sf); frow.appendChild(lf); sbody.appendChild(frow); sbody.appendChild(fin);
      var code = el('textarea', 'codebox'); code.rows = 3; code.placeholder = 'Your save code will appear here. To load one, paste it here.'; code.spellcheck = false;
      var srow = el('div', 'mrow');
      var mk = el('button', 'btn', 'Make a save code'); mk.type = 'button';
      mk.onclick = function () { BRAIN.exportCode(false).then(function (c) { code.value = c; code.focus(); code.select(); try { navigator.clipboard.writeText(c).then(function () { toast('Copied. Keep it somewhere safe.'); }, function () { toast('Select it all and copy it.'); }); } catch (e) { toast('Select it all and copy it.'); } }); };
      var ld = el('button', 'btn', 'Load this code'), armedL = false; ld.type = 'button';
      ld.onclick = function () {
        if (!code.value.trim()) { toast('Paste a save code first.'); return; }
        if (!armedL) { armedL = true; ld.textContent = tr('Tap again: replace her with this save'); setTimeout(function () { armedL = false; ld.textContent = tr('Load this code'); }, 4000); return; }
        loadSave(code.value, true);
      };
      srow.appendChild(mk); srow.appendChild(ld); sbody.appendChild(code); sbody.appendChild(srow);
      sbody.appendChild(el('p', 'foot', JA ? 'コードは写真なしの短い版です。長すぎてコピーできない時はファイルを使ってください。' : 'The code is the short version, without photos. If it\'s too long to copy on your phone, use the file instead.'));
      // memory
      sbody.appendChild(el('h3', null, 'Memory'));
      var forget = el('button', 'btn danger', 'Forget everything'), armed = false;
      forget.onclick = function () {
        if (!armed) { armed = true; forget.textContent = tr('Tap again: she forgets you, missions, points, house'); setTimeout(function () { armed = false; forget.textContent = tr('Forget everything'); }, 4000); return; }
        BRAIN.reset(); closeSheet();
      };
      sbody.appendChild(forget);
    }
    function saveText(name, text) {
      var an = BRAIN.android();
      if (an) {
        if (!an.saveFile) return Promise.reject(new Error(JA ? 'アプリを更新するとファイル保存が使えます。今はコードを使ってください。' : 'update the app to save files. Use the code for now.'));
        var where = ''; try { where = an.saveFile(name, text); } catch (e) {}
        return where ? Promise.resolve(where) : Promise.reject(new Error(JA ? '書き込めませんでした' : 'the phone refused to write it'));
      }
      function web() {
        try {
          var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), a = document.createElement('a');
          a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          return Promise.resolve(name);
        } catch (e) { return Promise.reject(e); }
      }
      if (window.claude && claude.use) return claude.use('downloads').then(function (d) {
        if (!d) return web();
        return d.save({ filename: name, data: text }).then(function () { return name; }, function (e) {
          if (e && (e.code === 'declined' || e.code === 'dismissed' || e.code === 'cancelled')) throw new Error(JA ? 'キャンセルしました' : 'cancelled');
          return d.save({ filename: name, data: new Blob([text], { type: 'text/plain' }) }).then(function () { return name; });
        });
      }, web);
      return web();
    }
    function loadSave(text, fromCode) {
      var m = /PSH[0-3]:[A-Za-z0-9+\/=_-]+/.exec(String(text).replace(/\s+/g, ''));
      if (!m) { toast(JA ? 'セーブが見つかりませんでした。' : 'There\'s no Pusheen save in that.'); return; }
      BRAIN.importCode(m[0]).then(function (r) { closeSheet(); toast(r === 'reload' ? (JA ? '読み込みました。言語を切り替えます…' : 'Loaded. Switching language…') : 'Loaded.'); })
        .catch(function (e) { toast((JA ? 'コードが使えませんでした：' : 'That code didn\'t work: ') + (e && e.message || tr('unknown problem'))); });
    }
    function liveSeason() { var m = new Date().getMonth(); return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter'; }
    var toastT = 0;
    function toast(t) { var e = $('toast'); e.textContent = tr(t); e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, 2400); }

    // ---------- wiring ----------
    BRAIN.on(function (type, d) {
      if (type === 'say') { speak(d.text, d.mood, d.cut, d.parts); $('hint').classList.add('gone'); widgetSoon(); }
      else if (type === 'senses') { var sn = BRAIN.senses(); VOICE.setDuck(sn.call ? 0 : sn.phones ? 0.5 : 1); }
      else if (type === 'heard') echo(d.text, d.photo);
      else if (type === 'offer') showOffer(d);
      else if (type === 'duo') { var dg = DUO.list.filter(function (x) { return x.id === d.id; })[0]; if (dg) startDuo(dg, true); }
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
      else if (type === 'imported') { if (d && d.voice) VOICE.set(d.voice); if (d && typeof d.sound === 'string') VOICE.setSound(d.sound); }
    });
    if (typeof MIND !== 'undefined') MIND.on(function (type, d) {
      if (type === 'openMail') openSheet('mail');
      else if (type === 'mail') { updateMailBadge(); if (sheetKind === 'mail') render(); }
      else if (type === 'photo') showPolaroid(d.img, d.cap);
      else if (type === 'focus') { updateFocus(); if (sheetKind === 'games') render(); }
      else if (type === 'focusTick') updateFocus();
      else if ((type === 'goal' || type === 'cat' || type === 'wall') && sheetKind === 'notebook') render();
    });
    var busyCheck = function () { return document.activeElement === input || BRAIN.busy || !sheet.hidden || !!cur || !!gameHost; };
    BODY.setBusy(busyCheck); BRAIN.setBusyCheck(function () { return document.activeElement === input || !sheet.hidden || !!cur || !!gameHost; });

    return {
      start: function () {
        translateDom(document.body);
        updatePoints(); updateBadge(); updateClock(); updateHouse(); updateFeel(); updateMute();
        setInterval(updateClock, 1000); setInterval(updateFeel, 1000); setTimeout(function () { updateMailBadge(); updateFocus(); }, 3000);
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
      updateClock: updateClock, openSheet: openSheet, speak: speak, voice: VOICE, startGame: startGame, startDuo: startDuo, tr: tr
    };
  })();
