'use strict';
  // ===================== MIND: colds, habits she notices, dreams, grudges, her savings, visitors, plants, mail, photos, studying together =====================
  var MIND = (function () {
    var K = BRAIN._k, EXT = K.EXT, T = K.T, fill = K.fill, pickL = K.pickL, chance = K.chance;
    var listeners = [];
    function emit(type, d) { listeners.forEach(function (fn) { try { fn(type, d == null ? {} : d); } catch (e) { console.error(e); } }); }
    function S() { return K.S; }
    function now() { return Date.now(); }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    function day(ts) { return K.herDay(ts); }
    function dowName(d) { return (d || new Date()).toLocaleDateString(K.JA ? 'ja-JP' : 'en-GB', { weekday: 'long' }); }
    function hm(h) { h = ((h % 24) + 24) % 24; return K.pad(Math.floor(h)) + ':' + K.pad(Math.round((h % 1) * 60) % 60); }
    function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; }
    function an() { return K.android(); }
    function visible() { return !document.hidden; }

    // ---------- her lines (Japanese versions live in lang.js and swap in) ----------
    var ML = {
      overlay: ['{app}. ‖ {min} minutes. ‖ I counted.', 'Still on {app}? ‖ It\'s been {min} minutes.', 'Hey. ‖ {min} minutes of {app}. ‖ Come see me instead.', '{min} minutes. ‖ Your thumb must be tired.'],
      refuse: {
        again: { leg: ['Not by the leg again.', 'No. ‖ I remember last time.', 'The leg is closed.'], arm: ['My arm is not a rope.', 'Again? ‖ No.'], body: ['Put me down. ‖ Properly, this time.', 'I\'m not a toy.'] },
        sick: ['Not now. ‖ I\'m sick.', 'Gently. ‖ I\'m made of tissues today.'],
        wriggle: ['Let go.', 'Hands off.', '…No.', 'I said let go.'],
        soothe: ['…Fine. ‖ Just the hand.', '…', '…Okay. ‖ That helps. A little.']
      },
      sick: {
        start: ['…Achoo. ‖ That was nothing.', 'I\'m not sick. ‖ …I\'m a little sick.', 'My nose is being dramatic today.'],
        idle: ['If I sneeze on the koi, it\'s not my fault.', 'Tea would be nice. ‖ Just saying.', 'I\'m resting. ‖ Very seriously.', 'Everything tastes like nothing. ‖ Even nothing.'],
        tea: ['…Warm. ‖ Thank you.', 'Ginger. ‖ My nose is grateful.', 'This helps. ‖ Don\'t tell anyone I said that.'],
        better: ['I\'m better. ‖ You can stop worrying. ‖ …If you were.', 'The cold\'s gone. ‖ I won.']
      },
      habit: {
        early: ['You\'re up early for a {day}.', 'Up already? ‖ It\'s {day}.'],
        late: ['You slept in. ‖ It\'s {day}, you\'re usually up by {usual}.', 'Up at {t}? ‖ On a {day}? ‖ Hm.'],
        missed: ['No {place} today? ‖ It\'s {day}.', '{day}. ‖ Usually that means {place}. ‖ Not today?'],
        kept: ['{place}. ‖ Like every {day}.', 'Back from {place}. ‖ Right on schedule.']
      },
      dream: {
        tell: ['I dreamt {a}. ‖ And {b}. ‖ …Don\'t analyse it.', 'Weird dream. ‖ {A}. ‖ Then I woke up.', 'Last night I dreamt {a}. ‖ I\'m still thinking about it.'],
        bits: { fish: 'the koi were wearing glasses', book: 'every page of my book was blank except one word', cat: 'the cat was the size of Fuji', rain: 'it rained tea',
                note: 'the lanterns were humming your song', star: 'you gave me a gold star the size of a door', swirl: 'the garden was spinning and only I noticed',
                shoe: 'you walked past the fence and didn\'t see me', heart: 'you were here in the garden, just sitting, and it was nice', house: 'my house had a hundred rooms and all of them were the same room',
                moon: 'the moon came down to the lake to drink', cloud: 'I was a cloud, and it was boring', food: 'I was eating something enormous and it kept getting bigger', phone: 'your phone was a window and I could see your room' }
      },
      grudge: {
        silentStart: ['…', '…'],
        silentReply: ['…', '…', '.', 'Hm.', '…'],
        silentEnd: ['…I\'m talking to you again. ‖ Don\'t make it weird.', 'Fine. ‖ The silence is over. ‖ For now.'],
        forgive: ['…Fine. ‖ Apology accepted. ‖ Don\'t do it again.', '…Okay. ‖ I heard you.', 'Hm. ‖ …Okay. We\'re fine.'],
        notEnough: ['…', 'That\'s not an apology. ‖ That\'s a sentence.'],
        old: ['I haven\'t forgotten, by the way. ‖ {what}. ‖ {when}.', '{when}, {what}. ‖ I\'m still thinking about it.', 'You never apologised. ‖ For {what}.'],
        oldDone: ['…Okay. ‖ I\'ll stop bringing it up.', 'Thank you. ‖ That\'s all I wanted.']
      },
      goal: {
        start: ['I\'ve decided something. ‖ I\'m saving up for {item}. ‖ {why}', 'New plan. ‖ {item}. ‖ I\'m saving for it myself.'],
        idle: ['{saved} out of {price} for {item}. ‖ Not that I\'m counting.', 'Still saving for {item}. ‖ Slowly.'],
        thanks: ['…You didn\'t have to. ‖ Thank you.', 'For my {item}? ‖ …Okay. Thank you.', 'That\'s a lot. ‖ …I\'ll pay you back. In some way.'],
        bought: ['I did it. ‖ I bought {item}. ‖ Myself. ‖ …With a little help.', '{item}. ‖ Mine. ‖ I saved for it. ‖ I\'m very proud of myself.']
      },
      cat: {
        arrive: ['…A cat.', 'Don\'t move. ‖ There\'s a cat.', '{cat} is here.'],
        fed: ['You fed it. ‖ Now it will never leave.', 'It likes you. ‖ Traitor.', 'Good. ‖ It looked hungry.'],
        named: ['I\'m calling it {cat}. ‖ It didn\'t object.', 'Its name is {cat}. ‖ I decided.'],
        pet: ['{cat} allows it.', '…It purred. ‖ At you.']
      },
      tanuki: ['…Tanuki. ‖ Don\'t move.', 'There\'s a tanuki. ‖ Act natural.'],
      birds: ['Birds on the fence. ‖ Don\'t scare them.'],
      plants: {
        thirsty: ['The {plant} is thirsty. ‖ Tap it to water it.', 'Someone hasn\'t watered the {plant}. ‖ …Someone.'],
        wilt: ['The {plant} is wilting. ‖ That\'s on both of us.', 'Look at the {plant}. ‖ It\'s giving up.'],
        watered: ['Thank you. ‖ It says thank you too.', 'Good. ‖ It needed that.'],
        grown: ['The {plant} is fully grown. ‖ Look at it.'],
        selfWater: ['I watered the plants. ‖ You\'re welcome, plants.']
      },
      mail: {
        postcard: ['There\'s a postcard in the mailbox. ‖ From {city}.', 'Mail. ‖ A postcard from {city}. ‖ …I wonder who sent it.'],
        letter: ['I wrote back. ‖ It\'s in the mailbox.', 'There\'s a letter for you. ‖ From me. ‖ In the mailbox.'],
        got: ['A letter. ‖ …I\'ll read it properly. ‖ Later. ‖ When you\'re not watching.', 'You wrote me a letter. ‖ …I\'ll answer. ‖ Give me a day.']
      },
      wall: ['I put it on my wall.', 'It\'s on my wall now. ‖ Next to the others.'],
      focus: {
        start: ['Okay. ‖ {min} minutes. ‖ I\'ll study too.', 'Focus. ‖ I\'m watching. ‖ …Studying. I\'m studying.'],
        back: ['You\'re back.', 'Good. ‖ Back to work.'],
        caught: ['{app}. ‖ During our focus.', 'You opened {app}. ‖ I saw that.', '{app}? ‖ Really?'],
        away: ['Where did you go? ‖ We were studying.', 'You left. ‖ For {mins} minutes.'],
        done: ['Done. ‖ You did it. ‖ Take a break, five minutes.', 'That\'s it. ‖ Good work. ‖ Stretch.'],
        doneMeh: ['Done. ‖ …Mostly.', 'Finished. ‖ With a few detours.'],
        quit: ['Giving up?', 'Already? ‖ …Fine.'],
        reply: ['Shh. ‖ Studying.', 'Later. ‖ Focus.', 'Back to work.']
      },
      photo: {
        sunset: ['Look. ‖ The sunset was showing off.', 'I took a picture for you. ‖ The sky did all the work.'],
        snow: ['First snow. ‖ I took a picture for you.'],
        fireworks: ['Hanabi. ‖ I saved one for you.'],
        fireflies: ['Fireflies. ‖ They wouldn\'t hold still.'],
        cat: ['{cat} posed. ‖ Barely.'],
        hanami: ['The cherry blossoms. ‖ Before they fall.'],
        new: ['My new {item}. ‖ I needed a photo.']
      },
      quiz: {
        ask: ['Quick question. ‖ {q}', 'Pop quiz. ‖ {q}', 'You read about this. ‖ {q}'],
        teach: ['Explain something to me. ‖ "{t}". ‖ Pretend I don\'t know.'],
        right: ['Correct. ‖ …I\'m impressed. A little.', 'Right. ‖ You actually read it.'],
        wrong: ['No. ‖ It\'s "{a}".', 'Close. ‖ …Not really. It\'s "{a}".']
      },
      events: {
        fireflies: ['Fireflies. ‖ Turn the lights off. ‖ Yours, I mean.'],
        fireworks: ['Fireworks tonight. ‖ …Come watch.', 'Hanabi. ‖ Over Fuji. ‖ Best seat in the world.'],
        typhoon: ['Typhoon day. ‖ I\'m staying in.', 'The wind is trying to take my house. ‖ It can\'t. ‖ I think.']
      }
    };
    if (K.JA && typeof JA_SETS !== 'undefined' && JA_SETS.MIND) (function merge(dst, src) {
      Object.keys(src).forEach(function (k) { var v = src[k]; if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v); else dst[k] = v; });
    })(ML, JA_SETS.MIND);
    Object.keys(ML.events).forEach(function (k) { if (K.LINES.events) K.LINES.events[k] = ML.events[k]; });
    // with a brain connected, these get freshly written too (see the line bank in brain.js)
    if (K.bank) {
      K.bank(ML.sick.idle, 'sick_idle', 'while she has a small cold, idle remarks', 3); K.bank(ML.sick.tea, 'sick_tea', 'being brought tea while she has a cold', 2);
      K.bank(ML.cat.arrive, 'cat_arrive', 'a stray cat named {cat} shows up in the garden', 2); K.bank(ML.cat.pet, 'cat_pet', 'when they pet {cat}, the stray cat', 2);
      K.bank(ML.tanuki, 'tanuki', 'a tanuki wanders into the garden', 2); K.bank(ML.birds, 'birds', 'birds land on the fence', 2);
      K.bank(ML.plants.watered, 'watered', 'when they water one of her plants', 2); K.bank(ML.plants.thirsty, 'thirsty', 'pointing out the {plant} needs water (they can tap it to water it)', 2);
      K.bank(ML.focus.reply, 'focus_reply', 'when they talk to her during a study session they started together', 3); K.bank(ML.focus.back, 'focus_back', 'when they come back to the app during a study session', 2);
      K.bank(ML.focus.caught, 'focus_caught', 'catching them opening {app} during a study session', 2);
      K.bank(ML.refuse.wriggle, 'wriggle', 'wriggling free when grabbed while she does not want to be', 3); K.bank(ML.refuse.soothe, 'soothe', 'calming down when they gently hold her hand', 2);
      K.bank(ML.grudge.forgive, 'forgive', 'accepting their apology after she gave them the silent treatment', 2);
      K.bank(ML.overlay, 'overlay', 'popping up over another app: they have been on {app} for {min} minutes', 3);
    }
    function sayP(list, v, face, act) { K.say(fill(pickL(list), K.vars(v || {})), face || null, act || null, { cut: true }); }

    // ---------- being handled: she says no to the same rough handling, more so when she's fed up ----------
    var handled = { arm: [], leg: [], body: [] }, refuseUntil = {}, lastSpin = 0, lastRefuseSay = 0;
    function handleRule(kind, state) {
      var t = now(), tm = K.temper(), li = K.levelIdx(S().op);
      handled[kind] = handled[kind].filter(function (x) { return t - x < 180000; });
      if (silent()) return { v: 'refuse', why: 'silent' };
      if (refuseUntil[kind] > t) return { v: 'refuse', why: 'again' };
      if (state === 'fedUp') {
        if (kind === 'leg' || tm === 'grumpy' || li <= 4) return { v: 'refuse', why: 'fedUp' };
        if (kind === 'arm' && (li >= 9 || tm === 'sad' || tm === 'kind' || tm === 'delighted')) return { v: 'ok', why: 'soothe' };
        if (kind === 'body' && li >= 11 && tm !== 'dismissive') return { v: 'ok', why: 'soothe' };
        return { v: 'refuse', why: 'fedUp' };
      }
      if (isSick() && kind === 'leg') return { v: 'refuse', why: 'sick' };
      var n = handled[kind].length;
      if (kind === 'leg' && (n >= 3 || (t - lastSpin < 120000 && n >= 1))) { refuseUntil.leg = t + 180000; return { v: 'refuse', why: 'again' }; }
      if ((kind === 'arm' && n >= 6) || (kind === 'body' && n >= 5)) return { v: 'wriggle', why: 'again' };
      if (isSick() && kind === 'body') return { v: 'wriggle', why: 'sick' };
      if (kind === 'leg' && (tm === 'grumpy' || tm === 'dismissive') && li <= 6) return { v: 'wriggle', why: 'mood' };
      return { v: 'ok' };
    }
    if (BODY.setHandleRule) BODY.setHandleRule(handleRule);
    BODY.on(function (type, d) {
      var t = now();
      if (type === 'grab' && handled[d.type]) handled[d.type].push(t);
      if (type === 'spun') { if (t - lastSpin < 10 * 60000 || (d.turns > 2 && (K.temper() === 'grumpy' || K.levelIdx(S().op) <= 5))) addGrudge('you swung me around by my leg', (S().n.spins || 0) >= 3 ? 3 : 2); lastSpin = t; }
      if (type === 'refused' && d.why && d.why !== 'fedUp' && t - lastRefuseSay > 4000 && !K.busy) {
        lastRefuseSay = t;
        if (d.why === 'silent') return;
        var list = d.why === 'sick' ? ML.refuse.sick : (ML.refuse.again[d.kind] || ML.refuse.again.body);
        setTimeout(function () { sayP(list, null, 'annoyed'); }, 300);
      }
      if (type === 'wriggled' && t - lastRefuseSay > 4000) { lastRefuseSay = t; setTimeout(function () { sayP(ML.refuse.wriggle, null, 'annoyed'); }, 200); K.note('wriggled free when you held her ' + d.kind); }
      if (type === 'soothed' && t - lastRefuseSay > 6000) { lastRefuseSay = t; K.note('let you hold her hand while she was fed up'); setTimeout(function () { sayP(ML.refuse.soothe, null, 'down'); }, 600); }
      if (type === 'touch') birdsFlee();
      if (type === 'mood' && d.state === 'asleep') makeDream(false);
    });

    // ---------- 17. a winter cold ----------
    function isSick() { var x = S().sick; return !!(x && now() < x.until); }
    var nextSneeze = 0;
    function sickTick() {
      var s = S(), t = now(), dk = day();
      if (s.sick && t >= s.sick.until) { s.sick = null; s.lastSick = t; BODY.setSick && BODY.setSick(false); K.remember('I had a cold and got over it.', 1); if (visible()) setTimeout(function () { sayP(ML.sick.better, null, 'content', 'sparkle'); }, 1500); K.save(); }
      if (!s.sick && s.sickCheck !== dk) {
        s.sickCheck = dk;
        var W = K.WEATHER, cold = SCENE.season() === 'winter' || (W && W.temp <= 4), wet = SCENE.weather() === 'rain' || SCENE.weather() === 'storm';
        var late = ((s.weeks && s.weeks[K.weekKey()]) || {}).late || 0;
        var p = (cold ? 0.06 : 0.008) + (wet ? 0.02 : 0) + (late >= 2 ? 0.03 : 0);
        if (t - (s.lastSick || 0) > 21 * 864e5 && chance(p)) {
          s.sick = { since: t, until: t + (2 + Math.random() * 2) * 864e5, lvl: cold ? 2 : 1 };
          K.remember('I caught a cold on ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + '.', 1);
          if (visible()) setTimeout(function () { BODY.perform(['sneeze']); sayP(ML.sick.start, null, 'down'); }, 3000);
        }
        K.save();
      }
      BODY.setSick && BODY.setSick(isSick());
    }
    setInterval(function () {
      if (!isSick() || !visible() || BODY.state !== 'awake' || K.busy) return;
      if (now() > nextSneeze) { nextSneeze = now() + (40 + Math.random() * 80) * 1000; BODY.perform(['sneeze']); }
    }, 5000);
    BRAIN.on(function (type, d) {
      if (type === 'fed' && d && (d.id === 'tea' || d.id === 'matcha') && isSick()) {
        var s = S(); s.sick.until = Math.max(now() + 2 * 3600e3, s.sick.until - 14 * 3600e3); K.warm(0.2, 'you brought me tea when I was sick'); K.opinion(1, 'tea when I was sick'); K.save();
        setTimeout(function () { sayP(ML.sick.tea, null, 'content'); }, 4200);
      }
      if (type === 'fed' && d && d.id === 'natto' && (S().flags['ate:natto'] || 0) >= 2) addGrudge('you made me eat natto again', 1);
      if (type === 'heard' && d && d.photo) wallAdd(d.photo);
      if (type === 'loc') tripCheck();
    });

    // ---------- 18. habits she notices ----------
    function habRecordOpen() {
      var s = S(), dk = day(), h = K.hourOf(); s.hab = s.hab || { open: {} };
      if (!s.hab.open[dk]) { s.hab.open[dk] = { h: h < 5 ? h + 24 : h, dow: new Date().getDay() }; }
      var keys = Object.keys(s.hab.open).sort(); keys.slice(0, -42).forEach(function (k) { delete s.hab.open[k]; });
    }
    function sleepRows() {
      var hist = S().sleepHist || {}, out = [];
      Object.keys(hist).sort().slice(-35).forEach(function (k) {
        var r = hist[k]; if (!r || !r.woke || !r.slept) return;
        var w = new Date(r.woke), sl = new Date(r.slept), bh = sl.getHours() + sl.getMinutes() / 60;
        out.push({ dow: w.getDay(), wake: w.getHours() + w.getMinutes() / 60, bed: bh < 12 ? bh + 24 : bh, d: k });
      });
      return out;
    }
    function habits() {
      var out = [], rows = sleepRows(), wd = function (r) { return r.dow >= 1 && r.dow <= 5; };
      [['weekdays', rows.filter(wd), 5], ['weekends', rows.filter(function (r) { return !wd(r); }), 3]].forEach(function (g) {
        if (g[1].length < g[2]) return;
        var wk = g[1].map(function (r) { return r.wake; }), md = median(wk), spread = median(wk.map(function (x) { return Math.abs(x - md); }));
        if (spread <= 0.7) out.push({ key: 'wake:' + g[0], kind: 'wake', group: g[0], h: md, text: K.JA ? (g[0] === 'weekdays' ? '平日' : '週末') + 'はだいたい' + hm(md) + 'ごろ起きる' : 'usually up around ' + hm(md) + ' on ' + g[0] });
        var bd = g[1].map(function (r) { return r.bed; }), mb = median(bd), sb = median(bd.map(function (x) { return Math.abs(x - mb); }));
        if (sb <= 0.8) out.push({ key: 'bed:' + g[0], kind: 'bed', group: g[0], h: mb, text: K.JA ? (g[0] === 'weekdays' ? '平日' : '週末') + 'の夜はだいたい' + hm(mb) + 'ごろ寝る' : 'usually asleep around ' + hm(mb) + ' on ' + (g[0] === 'weekdays' ? 'weeknights' : 'weekend nights') });
      });
      // places on the same weekday, most weeks
      var log = (S().placeLog || []).filter(function (e) { return e.kind === 'enter' && now() - e.at < 35 * 864e5; }), byKey = {};
      log.forEach(function (e) {
        var d = new Date(e.at), k = e.id + '|' + d.getDay(), wkn = K.weekKey(e.at);
        var p = (S().places || []).filter(function (x) { return x.id === e.id; })[0]; if (!p || p.kind === 'home') return;
        var b = byKey[k] || (byKey[k] = { id: e.id, dow: d.getDay(), weeks: {}, hours: [] }); b.weeks[wkn] = 1; b.hours.push(d.getHours() + d.getMinutes() / 60);
      });
      Object.keys(byKey).forEach(function (k) {
        var b = byKey[k]; if (Object.keys(b.weeks).length < 3) return;
        var nm = K.placeName(b.id), dn = dowName(new Date(2026, 10, 15 + b.dow)), mh = median(b.hours);
        out.push({ key: 'place:' + k, kind: 'place', id: b.id, dow: b.dow, h: mh, name: nm, text: K.JA ? '毎週' + dn + 'の' + hm(mh) + 'ごろ「' + nm + '」に行く' : 'goes to ' + nm + ' on ' + dn + 's around ' + hm(mh) });
      });
      return out;
    }
    function habitToday() {
      var hs = habits(), d = new Date(), dk = day(), out = [], dn = dowName(d), weekday = d.getDay() >= 1 && d.getDay() <= 5;
      var sl = (S().sleepHist || {})[dk];
      hs.forEach(function (h) {
        if (h.kind === 'wake' && sl && sl.woke && (h.group === 'weekdays') === weekday) {
          var w = new Date(sl.woke), wh = w.getHours() + w.getMinutes() / 60, diff = wh - h.h;
          if (Math.abs(diff) >= 1.25) out.push({ key: 'wake', line: diff < 0 ? 'early' : 'late', v: { day: dn, usual: hm(h.h), t: K.hhmm(w) }, text: (diff < 0 ? 'up early today (' : 'slept in today (') + K.hhmm(w) + ', usually ' + hm(h.h) + ')' });
        }
        if (h.kind === 'place' && h.dow === d.getDay()) {
          var went = (S().placeLog || []).some(function (e) { return e.id === h.id && e.kind === 'enter' && day(e.at) === dk; });
          if (went) out.push({ key: 'place:' + h.id, line: 'kept', v: { day: dn, place: h.name }, text: 'went to ' + h.name + ' as usual' });
          else if (K.hourOf() > h.h + 1.5) out.push({ key: 'place:' + h.id, line: 'missed', v: { day: dn, place: h.name }, text: 'did not go to ' + h.name + ' today, unlike most ' + dn + 's' });
        }
      });
      return out;
    }
    function habitLine() {
      var s = S(), dk = day(); s.habSaid = s.habSaid && s.habSaid.d === dk ? s.habSaid : { d: dk, k: {} };
      var c = habitToday().filter(function (x) { return !s.habSaid.k[x.key] && ML.habit[x.line]; })[0];
      if (!c || (c.line === 'kept' && !chance(0.4))) return null;
      s.habSaid.k[c.key] = 1; K.save();
      return fill(pickL(ML.habit[c.line]), c.v);
    }

    // ---------- 19. dreams ----------
    function dreamSymbols() {
      var s = S(), t = now(), sy = [], add = function (x) { if (sy.indexOf(x) < 0) sy.push(x); };
      if (s.fedAt && t - s.fedAt < 18 * 3600e3) add('food');
      if (s.study && s.study.lastRead && s.study.week === K.weekKey()) add('book');
      if (s.cat && s.cat.last && t - s.cat.last < 20 * 3600e3) add('cat');
      var wx = SCENE.weather(); if (wx === 'rain' || wx === 'storm' || wx === 'drizzle') add('rain');
      if (s.missions.some(function (m) { return m.status === 'done' && t - m.end < 18 * 3600e3; })) add('star');
      if (s.n.spins && s.day && s.day.rough >= 2) add('swirl');
      if ((s.placeLog || []).some(function (e) { return t - e.at < 18 * 3600e3; })) add('shoe');
      if (s.screen && s.screen.total > 300) add('phone');
      if (K.levelIdx(s.op) >= 9) add('heart');
      if (s.owned.house && chance(0.3)) add('house');
      ['moon', 'fish', 'cloud'].forEach(function (x) { if (sy.length < 3) add(x); });
      return sy.slice(0, 4);
    }
    function makeDream(force) {
      var s = S(), h = K.hourOf(), night = h >= 21 || h < 6, dk = night && h < 6 ? K.herDay() : K.herDay(now() + 6 * 3600e3);
      var sy = dreamSymbols();
      BODY.setDream && BODY.setDream(sy);
      if (night && (!s.dream || s.dream.d !== dk || force)) { s.dream = { d: dk, sy: sy, told: false }; K.save(); }
    }
    function tellDream(queue) {
      var s = S(), dk = K.herDay(), h = K.hourOf();
      if (!s.dream || s.dream.told || h < 6 || h > 15) return;
      if (s.dream.d !== dk) { if (s.dream.d < dk) s.dream.told = true; return; }
      s.dream.told = true; K.save();
      var bits = s.dream.sy.map(function (x) { return ML.dream.bits[x]; }).filter(Boolean);
      if (K.brainKind() !== 'off' && !queue) {
        K.respond('Tell them, briefly and in your own voice, about the dream you had last night. Make it a little surreal but built from these pieces of your day: ' + s.dream.sy.join(', ') + '. Two to four short sentences. Don\'t interpret it.', { silent: true });
        return;
      }
      var a = bits[0] || ML.dream.bits.moon, b = bits[1] || ML.dream.bits.cloud;
      var line = fill(pickL(ML.dream.tell), { a: a, b: b, A: a.charAt(0).toUpperCase() + a.slice(1) });
      if (queue) queue.push([line, 'sleepy']); else K.say(line, 'sleepy');
    }

    // ---------- 20. grudges and the silent treatment ----------
    var APOLOGY = /\b(sorry|apolog|forgive me|my bad|i was wrong)|d[ée]sol[ée]|pardon|excuse[- ]moi|je m'excuse|ごめん|すみません|すまん|申し訳|悪かった|許して/i;
    function silent() { var x = S().silent; return !!(x && now() < x.until); }
    function addGrudge(what, w) {
      var s = S(); s.grudges = (s.grudges || []).filter(function (g) { return now() - g.at < 21 * 864e5; });
      var g = { id: K.newId('g'), what: String(what).slice(0, 90), w: K.clampN(Math.round(w || 1), 1, 3), at: now(), ok: false, told: 0 };
      s.grudges.push(g); s.grudges = s.grudges.slice(-8); K.save();
      if (g.w >= 2 && !silent()) {
        var tm = K.temper(), li = K.levelIdx(s.op);
        var p = tm === 'grumpy' || tm === 'dismissive' || li <= 6 ? 0.5 + 0.2 * (g.w - 2) : (tm === 'kind' || tm === 'delighted') && li >= 10 ? 0.1 : 0.3;
        if (chance(p)) startSilent(g);
      }
      return g;
    }
    function startSilent(g) {
      var s = S(); s.silent = { until: now() + Math.min(180, (25 + Math.random() * 35) * g.w) * 60000, why: g.what, gid: g.id, at: now(), tries: 0 };
      K.save(); K.emit('feel'); emit('silent', { on: true });
      setTimeout(function () { K.say('…', 'away', 'sulk', { cut: true }); }, 1800);
    }
    function endSilent(forgiven) {
      var s = S(), x = s.silent; if (!x) return; s.silent = null;
      if (forgiven) { (s.grudges || []).forEach(function (g) { if (g.id === x.gid) g.ok = true; }); K.opinion(1, 'they apologised properly'); s.forgivenAt = now(); }
      K.save(); K.emit('feel'); emit('silent', { on: false });
    }
    setInterval(function () { var x = S().silent; if (x && now() >= x.until) { endSilent(false); if (visible()) sayP(ML.grudge.silentEnd, null, 'away'); } }, 20000);
    function openGrudges() { return (S().grudges || []).filter(function (g) { return !g.ok && now() - g.at < 10 * 864e5; }); }
    function oldGrudgeLine() {
      var g = openGrudges().filter(function (x) { return x.w >= 2 && x.told < 2 && now() - x.at > 20 * 3600e3; })[0];
      if (!g || !chance(0.5)) return null;
      g.told++; g.toldAt = now(); K.save();
      var when = dowName(new Date(g.at));
      return fill(pickL(ML.grudge.old), { what: g.what, when: when });
    }

    // ---------- 21. her own savings ----------
    var GOALS = [{ id: 'telescope', name: 'Telescope', price: 120, why: 'To see the stars properly.' }, { id: 'easel', name: 'Easel and paints', price: 80, why: 'I want to paint Fuji. Badly, probably.' },
                 { id: 'goldfish', name: 'Goldfish bowl', price: 60, why: 'A friend who doesn\'t talk back.' }, { id: 'kite', name: 'Kite', price: 40, why: 'For windy days.' }];
    function goalDef(id) { return GOALS.filter(function (g) { return g.id === id; })[0]; }
    function goalTick() {
      var s = S(), t = now();
      if (!s.goal && s.flags.met && t - (s.born || t) > 2 * 864e5 && t - (s.lastGoal || 0) > 2 * 864e5) {
        var g = GOALS.filter(function (x) { return !s.owned[x.id]; })[0];
        if (g) { s.goal = { id: g.id, saved: 0, since: t, told: false }; s.goalN = { done: s.n.done, games: 0 }; K.save(); emit('goal'); }
      }
      if (!s.goal) return;
      // her little income: missions you finish, games you play together, a coin a day
      var gn = s.goalN || (s.goalN = { done: s.n.done, games: 0 });
      if (s.n.done > gn.done) { s.goal.saved += 2 * (s.n.done - gn.done); gn.done = s.n.done; }
      var gm = s.games && s.games.day === day() ? s.games.n : 0; if (gn.gday !== day()) { gn.gday = day(); gn.games = 0; }
      if (gm > gn.games) { s.goal.saved += Math.min(3 - Math.min(3, gn.games), gm - gn.games); gn.games = gm; }
      if (s.goalDay !== day()) { s.goalDay = day(); s.goal.saved += 2; }
      var def = goalDef(s.goal.id);
      if (def && s.goal.saved >= def.price) {
        s.owned[def.id] = 1; SCENE.setOwned(s.owned); s.goal = null; s.lastGoal = t;
        K.remember('I saved up and bought a ' + def.name.toLowerCase() + ' myself.', 3); K.opinion(0.5, 'they helped me save');
        K.save(); emit('goal'); K.emit('points');
        if (visible()) setTimeout(function () { BODY.perform(['cheer', 'hop']); sayP(ML.goal.bought, { item: T(def.name) }, 'happy', 'sparkle'); setTimeout(function () { snap('new', { item: T(def.name) }); }, 6000); }, 1200);
      }
      K.save();
    }
    function goalInfo() { var s = S(), g = s.goal; if (!g) return null; var d = goalDef(g.id); return d ? { id: d.id, name: T(d.name), price: d.price, saved: Math.min(g.saved, d.price), why: T(d.why) } : null; }
    function helpGoal(n) {
      var s = S(), gi = goalInfo(); if (!gi) return false;
      n = Math.min(n, s.points, gi.price - gi.saved); if (n <= 0) return false;
      s.points -= n; s.goal.saved += n; K.opinion(0.15 * n / 5, 'they chipped in for my ' + gi.name.toLowerCase()); K.warm(0.1, 'you helped me save');
      K.save(); K.emit('points'); emit('goal');
      sayP(ML.goal.thanks, { item: gi.name }, 'content');
      setTimeout(goalTick, 1500);
      return true;
    }

    // ---------- 22. visitors: a stray cat, birds, a tanuki at night ----------
    var V = { cat: null, birds: null, tanuki: null };
    var CAT_NAMES = ['Mochi', 'Kinako', 'Tofu', 'Daikon', 'Sir Whiskers', 'Ponzu', 'Anko'];
    function catName() { var c = S().cat; return c && c.name ? c.name : T('the cat'); }
    function visitorsTick() {
      var s = S(), t = now(), h = K.hourOf(), outside = BODY.place !== 'house', wx = SCENE.weather(), wet = wx === 'rain' || wx === 'storm' || wx === 'drizzle' || isTyphoon();
      s.cat = s.cat || { fed: 0 };
      // the cat
      if (V.cat && (t > V.cat.leave || wet || h < 7 || h > 20)) { V.cat.state = 'leave'; }
      if (V.cat && V.cat.state === 'gone') V.cat = null;
      if (!V.cat && !wet && h >= 7 && h < 19.5 && visible() && t - (s.cat.lastSeen || 0) > 40 * 60000) {
        var friend = s.cat.fed >= 3, p = friend ? 0.12 : 0.05;
        if (chance(p)) {
          V.cat = { x: 3600, tx: 300 + Math.random() * 1800, state: 'walk', leave: t + (friend ? 15 + Math.random() * 20 : 6 + Math.random() * 8) * 60000, seen: t };
          s.cat.lastSeen = t; s.cat.last = t; K.save();
          if (outside && BODY.state === 'awake' && !K.busy) setTimeout(function () { sayP(ML.cat.arrive, { cat: catName() }, 'surprised'); }, 5000);
        }
      }
      // birds on the fence
      if (!V.birds && !wet && h > 6 && h < 18.5 && chance(0.08)) V.birds = { list: [0, 1, 2].slice(0, 2 + Math.floor(Math.random() * 2)).map(function (i) { return { x: -900 + Math.random() * 3600, y: 0, fly: 0, hop: Math.random() * 6 }; }), until: t + 8 * 60000 };
      if (V.birds && t > V.birds.until) V.birds = null;
      // a tanuki, some nights
      if (!V.tanuki && (h >= 21 || h < 2) && visible() && t - (s.tanukiAt || 0) > 2 * 864e5 && chance(0.2)) {
        V.tanuki = { x: -2000, v: 70, start: t }; s.tanukiAt = t; K.save();
        if (outside && BODY.state === 'awake') setTimeout(function () { sayP(ML.tanuki, null, 'surprised'); }, 6000);
      }
      if (V.tanuki && t - V.tanuki.start > 90000) V.tanuki = null;
      pushVisitors();
    }
    function pushVisitors() { SCENE.setVisitors && SCENE.setVisitors({ cat: V.cat, catFriend: (S().cat || {}).fed >= 3, birds: V.birds && V.birds.list, tanuki: V.tanuki, herX: 660 }); }
    function birdsFlee() { if (V.birds && V.birds.list) V.birds.list.forEach(function (b) { if (!b.fly) b.fly = now(); }); setTimeout(function () { V.birds = null; pushVisitors(); }, 2500); }
    function tapCat() {
      var s = S(), c = s.cat || (s.cat = { fed: 0 }), t = now();
      if (!V.cat) return;
      V.cat.leave = Math.max(V.cat.leave, t + 4 * 60000);
      if (t - (c.fedAt || 0) > 30 * 60000 && s.points >= 3) {
        s.points -= 3; c.fed++; c.fedAt = t; V.cat.state = 'eat'; V.cat.eatUntil = t + 6000; K.emit('points'); emit('cat', { fed: c.fed });
        if (c.fed === 3 && !c.name) {
          c.name = pickL(CAT_NAMES); K.remember('A stray cat started visiting. I named it ' + c.name + '.', 2);
          setTimeout(function () { sayP(ML.cat.named, { cat: c.name }, 'happy'); }, 1500);
        } else setTimeout(function () { sayP(ML.cat.fed, { cat: catName() }, 'content'); }, 1200);
        K.note('fed the stray cat'); K.save();
      } else {
        V.cat.state = 'purr'; V.cat.eatUntil = t + 3000;
        if (c.name && chance(0.5)) setTimeout(function () { sayP(ML.cat.pet, { cat: c.name }, 'content'); }, 800);
      }
      pushVisitors();
      if (c.fed >= 3 && chance(0.5)) setTimeout(function () { snap('cat', { cat: catName() }); }, 8000);
    }

    // ---------- 23. plants grow, get thirsty and wilt ----------
    var PLANT_IDS = ['fern', 'hydrangea', 'sunflower', 'bonsai', 'sapling'];
    function plantsTick() {
      var s = S(), t = now(); s.plants = s.plants || {};
      PLANT_IDS.forEach(function (id) {
        if (!s.owned[id]) { delete s.plants[id]; return; }
        var p = s.plants[id] || (s.plants[id] = { at: t, water: t, grow: s.flags.plantsV2 ? 0.5 : 1, upd: t });
        var dt = (t - (p.upd || t)) / 864e5, dry = (t - p.water) / 864e5;
        if (dry < 2.5 && p.grow < 1) { p.grow = Math.min(1, p.grow + dt / 14); if (p.grow >= 1 && !p.toldGrown) { p.toldGrown = true; if (visible()) setTimeout(function () { sayP(ML.plants.grown, { plant: T(plantName(id)) }, 'happy'); }, 4000); } }
        p.upd = t;
      });
      s.flags.plantsV2 = 1;
      pushPlants();
    }
    function plantName(id) { return { fern: 'fern', hydrangea: 'hydrangea', sunflower: 'sunflowers', bonsai: 'bonsai', sapling: 'cherry sapling' }[id] || id; }
    function wiltOf(p) { var dry = (now() - p.water) / 864e5; return dry < 2 ? 0 : dry < 3.5 ? 0.25 : dry < 6 ? 0.6 : 1; }
    function pushPlants() {
      var s = S(), st = {}; Object.keys(s.plants || {}).forEach(function (id) { var p = s.plants[id]; st[id] = { g: 0.5 + 0.5 * p.grow, w: wiltOf(p) }; });
      SCENE.setPlants && SCENE.setPlants(st);
    }
    function waterPlant(id, byHer) {
      var p = (S().plants || {})[id]; if (!p) return;
      var was = wiltOf(p); p.water = now(); K.save(); pushPlants(); SCENE.water && SCENE.water(id);
      if (!byHer) { K.note('watered the ' + plantName(id)); if (was > 0) { K.opinion(0.4, 'they watered my plants'); setTimeout(function () { sayP(ML.plants.watered, null, 'content'); }, 900); } }
    }
    function thirstyPlant() {
      var s = S(), best = null; Object.keys(s.plants || {}).forEach(function (id) { var w = wiltOf(s.plants[id]); if (w > 0 && (!best || w > best.w)) best = { id: id, w: w }; });
      return best;
    }
    // during her watering hour she sometimes does it herself (not always: that's what you're for)
    function maybeSelfWater() {
      var r = K.routineNow(), tm = K.temper(), s = S(); if (r.id !== 'water' || BODY.place === 'house' || s.selfWater === day()) return;
      s.selfWater = day(); var p = tm === 'kind' || tm === 'delighted' ? 0.6 : tm === 'calm' ? 0.4 : 0.15;
      if (chance(p)) { Object.keys(s.plants || {}).forEach(function (id) { waterPlant(id, true); }); if (chance(0.4)) sayP(ML.plants.selfWater, null, 'content'); }
      K.save();
    }

    // ---------- 24. postcards from your real trips ----------
    function tripCheck() {
      var s = S(), L = s.loc; if (!L || !L.city || L.manual) return;
      s.cityDays = s.cityDays || {}; var dk = day(), cd = s.cityDays[L.city] || (s.cityDays[L.city] = { n: 0, last: '' });
      if (cd.last !== dk) { cd.n++; cd.last = dk; }
      var home = Object.keys(s.cityDays).sort(function (a, b) { return s.cityDays[b].n - s.cityDays[a].n; })[0];
      var homePlace = (s.places || []).filter(function (p) { return p.kind === 'home'; })[0];
      var far = homePlace && L.lat != null ? distKm(L.lat, L.lon, homePlace.lat, homePlace.lon) > 35 : L.city !== home && s.cityDays[home].n >= 3;
      if (!far) { s.trip = null; K.save(); return; }
      s.trip = s.trip || { at: now(), cities: [] };
      if (s.trip.cities.indexOf(L.city) >= 0) return;
      s.trip.cities.push(L.city);
      var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
      var card = { id: K.newId('pc'), city: L.city, country: L.country || '', at: now(), deliver: d.getTime(), read: false, motif: pickL(['mountain', 'sea', 'tower', 'bridge', 'temple', 'flower', 'bread', 'castle']), text: null };
      s.mail = s.mail || []; s.mail.push(Object.assign({ kind: 'postcard' }, card)); s.mail = s.mail.slice(-40); K.save();
      writePostcard(card.id);
      var a = an(); if (a && a.notifyAt) try { a.notifyAt(Math.max(60, Math.round((card.deliver - now()) / 1000)), 'Pusheen', T('There\'s a postcard in the mailbox.')); } catch (e) {}
    }
    function distKm(a, b, c, d) { var r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.sqrt(x * x + y * y) * 6371; }
    function writePostcard(id) {
      var m = (S().mail || []).filter(function (x) { return x.id === id; })[0]; if (!m) return;
      var fallback = fill(pickL(K.JA ? ['{city}より。‖ 行ったことはないけど。‖ あなたはあるね。話を聞かせて。', '{city}からこんにちは。‖ 楽しんでる？‖ ちゃんと寝てる？'] : ['Greetings from {city}. ‖ I\'ve never been. ‖ You have, though. Tell me about it.', 'Hello from {city}. ‖ Are you having fun? ‖ Are you sleeping enough?']), { city: m.city }).replace(/\s*‖\s*/g, ' ');
      if (K.brainKind() === 'off') { m.text = fallback; K.save(); return; }
      K.callAI('You are Pusheen, a dry, calm, secretly affectionate girl who lives in a phone app garden. The person whose phone you live in is travelling: they are in ' + m.city + (m.country ? ', ' + m.country : '') + ' right now. Write the back of a postcard "from ' + m.city + '" to them, as if you had a peek at the place through their phone: 2 to 4 short sentences, one real detail about ' + m.city + ', in your voice. ' + (K.JA ? 'Write in natural casual Japanese.' : 'Write in English.') + ' Reply with JSON only: {"text": "the postcard"}', true, null, 400)
        .then(function (r) { m.text = r && typeof r.text === 'string' && r.text.trim() ? r.text.trim().slice(0, 400) : fallback; K.save(); }, function () { m.text = fallback; K.save(); });
    }
    function mailTick(queue) {
      var s = S(), t = now(), arrived = (s.mail || []).filter(function (m) { return !m.announced && m.deliver <= t && (m.text || t - m.deliver > 3600e3); });
      if (!arrived.length) return;
      arrived.forEach(function (m) { m.announced = true; if (!m.text) m.text = m.kind === 'postcard' ? fill(T('Greetings from {city}.'), { city: m.city }) : '…'; });
      K.save(); emit('mail'); pushMail();
      var pc = arrived.filter(function (m) { return m.kind === 'postcard'; })[0], lt = arrived.filter(function (m) { return m.kind === 'letter'; })[0];
      var line = lt ? fill(pickL(ML.mail.letter), {}) : pc ? fill(pickL(ML.mail.postcard), { city: pc.city }) : null;
      if (line) { if (queue) queue.push([line, 'content']); else if (visible() && !K.busy) K.say(line, 'content'); }
    }
    function unreadMail() { var t = now(); return (S().mail || []).filter(function (m) { return m.announced && !m.read && m.deliver <= t; }).length; }
    function pushMail() { SCENE.setMail && SCENE.setMail({ has: (S().mail || []).some(function (m) { return m.deliver <= now(); }) || (S().letters || []).length > 0, flag: unreadMail() > 0 }); }

    // ---------- 28. letters: she answers a day later ----------
    function writeLetter(text) {
      text = String(text || '').trim().slice(0, 3000); if (text.length < 4) return false;
      var s = S(), t = now(); s.mail = s.mail || [];
      s.mail.push({ id: K.newId('l'), kind: 'mine', text: text, at: t, deliver: t, read: true, announced: true });
      var d = new Date(t + (16 + Math.random() * 10) * 3600e3); if (d.getHours() < 8) d.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0);
      var reply = { id: K.newId('l'), kind: 'letter', text: null, at: d.getTime(), deliver: d.getTime(), read: false, re: text.slice(0, 80) };
      s.mail.push(reply); s.mail = s.mail.slice(-40);
      K.opinion(1.5, 'they wrote me a letter'); K.warm(0.25, 'you wrote me a letter'); K.remember('They wrote me a letter. It started: "' + text.slice(0, 60) + '…"', 2);
      K.save(); emit('mail');
      sayP(ML.mail.got, null, 'content');
      composeReply(reply.id, text);
      var a = an(); if (a && a.notifyAt) try { a.notifyAt(Math.max(60, Math.round((reply.deliver - t) / 1000)), 'Pusheen', T('A letter came. It\'s from me.')); } catch (e) {}
      return true;
    }
    function composeReply(id, theirs) {
      var m = (S().mail || []).filter(function (x) { return x.id === id; })[0]; if (!m) return;
      var tm = K.temper(), li = K.levelIdx(S().op);
      var fallback = (K.JA ? ['手紙ありがとう。', '二回読んだ。', li >= 8 ? '書いてくれてうれしかった。本当に。' : 'ちゃんと読んだよ。', '「' + theirs.slice(0, 30) + '…」のところ、覚えとく。', 'また書いて。‖ 返事はまた一日かかるけど。', '— プシーン']
                             : ['Thank you for your letter.', 'I read it twice.', li >= 8 ? 'I liked that you wrote. Really.' : 'I read all of it, properly.', 'The part that started "' + theirs.slice(0, 40) + '…" — I\'m keeping that.', 'Write again. ‖ I\'ll take a day again.', '— Pusheen']).join('\n').replace(/\s*‖\s*/g, ' ');
      if (K.brainKind() === 'off') { m.text = fallback; K.save(); return; }
      K.callAI('You are Pusheen, a dry, calm, secretly affectionate girl who lives in a phone app garden at the foot of Mount Fuji. The person whose phone you live in wrote you a real letter. You are answering it by letter (they will read it tomorrow). Your mood today: ' + tm + '. What you think of them: ' + K.levelName(li) + '. Things you remember: ' + S().mem.slice(-8).map(function (x) { return x.text; }).join(' / ') + '\n\nTHEIR LETTER:\n' + theirs + '\n\nWrite your letter back: answer what they actually wrote, ask one thing back, 80 to 220 words, plain paragraphs, signed "— Pusheen". Stay in your voice: honest, a little dry, warm underneath. ' + (K.JA ? 'Write in natural Japanese (plain form).' : 'Write in the language of their letter.') + ' Reply with JSON only: {"letter": "..."}', false, null, 1200)
        .then(function (r) { m.text = r && typeof r.letter === 'string' && r.letter.trim().length > 20 ? r.letter.trim().slice(0, 3000) : fallback; K.save(); }, function () { m.text = fallback; K.save(); });
    }
    function mailList() { var t = now(); return (S().mail || []).filter(function (m) { return m.kind === 'mine' || m.deliver <= t; }).slice().reverse(); }
    function readMail(id, quiet) { var m = (S().mail || []).filter(function (x) { return x.id === id; })[0]; if (m && !m.read) { m.read = true; K.save(); pushMail(); if (!quiet) emit('mail'); } }

    // ---------- 25. photos you send her end up on her wall ----------
    var LS_WALL = 'pusheen.wall', LS_ALBUM = 'pusheen.album';
    function shrink(src, maxW, q) {
      return new Promise(function (res) {
        var im = new Image(); im.onload = function () { var k = Math.min(1, maxW / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q || 0.72)); };
        im.onerror = function () { res(null); }; im.src = src;
      });
    }
    function wallAdd(src) {
      shrink(src, 220, 0.7).then(function (img) {
        if (!img) return;
        var w = lsGet(LS_WALL, []); w.push({ id: K.newId('w'), at: now(), img: img, cap: '' }); while (w.length > 8) w.shift();
        lsSet(LS_WALL, w); pushWall(); emit('wall');
        if (w.length === 1 || chance(0.3)) setTimeout(function () { if (!K.busy) sayP(ML.wall, null, 'content'); }, 9000);
      });
    }
    var wallImgs = {};
    function pushWall() {
      var w = lsGet(LS_WALL, []);
      SCENE.setWall && SCENE.setWall(w.map(function (x) { if (!wallImgs[x.id]) { var im = new Image(); im.src = x.img; wallImgs[x.id] = im; } return { id: x.id, img: wallImgs[x.id] }; }));
    }

    // ---------- 30. she takes pictures of nice moments ----------
    function snap(kind, v) {
      var sh = document.getElementById('sheet');
      if (!visible() || (sh && !sh.hidden) || document.querySelector('.game') || (BODY.place === 'house' && kind !== 'new')) return false;
      var s = S(), dk = day(); s.snaps = s.snaps && s.snaps.d === dk ? s.snaps : { d: dk, n: 0, k: {} };
      if (s.snaps.k[kind] || s.snaps.n >= 2) return false;
      var cv = document.getElementById('stage'); if (!cv) return false;
      var w = 420, h = Math.round(cv.height / cv.width * w), c = document.createElement('canvas'); c.width = w; c.height = Math.min(h, 560);
      var g = c.getContext('2d'); g.drawImage(cv, 0, (cv.height - c.height / w * cv.width) / 2, cv.width, c.height / w * cv.width, 0, 0, w, c.height);
      var img; try { img = c.toDataURL('image/jpeg', 0.72); } catch (e) { return false; }
      s.snaps.n++; s.snaps.k[kind] = 1; K.save();
      var cap = fill(pickL(ML.photo[kind] || ML.photo.sunset), K.vars(v || {}));
      var al = lsGet(LS_ALBUM, []), id = K.newId('ph'); al.push({ id: id, at: now(), img: img, cap: cap.replace(/\s*‖\s*/g, ' ') }); while (al.length > 12) al.shift();
      if (!lsSet(LS_ALBUM, al)) { al.splice(0, 4); lsSet(LS_ALBUM, al); }
      K.say(cap, 'content', null, { cut: true, photo: id });
      emit('photo', { id: id, img: img, cap: cap });
      return true;
    }
    function photoTick() {
      if (!visible() || BODY.place === 'house' || BODY.state === 'asleep') return;
      var h = SCENE.skyHour ? SCENE.skyHour() : K.hourOf(), ev = K.eventsToday(), n = SCENE.nightness();
      if (h > 17.9 && h < 18.5 && chance(0.25)) snap('sunset');
      else if (SCENE.weather() === 'snow' && chance(0.2) && !(S().flags.snowPic === K.ymd(new Date()).slice(0, 4) + SCENE.season())) { if (snap('snow')) S().flags.snowPic = K.ymd(new Date()).slice(0, 4) + SCENE.season(); }
      else if (ev.indexOf('fireworks') >= 0 && n > 0.6 && fireworksOn() && chance(0.3)) snap('fireworks');
      else if (ev.indexOf('fireflies') >= 0 && n > 0.6 && chance(0.2)) snap('fireflies');
      else if (ev.indexOf('hanami') >= 0 && n < 0.2 && chance(0.1)) snap('hanami');
    }
    function album() { return lsGet(LS_ALBUM, []).slice().reverse(); }
    function albumImg(id) { var x = lsGet(LS_ALBUM, []).filter(function (p) { return p.id === id; })[0]; return x ? x.img : null; }

    // ---------- 26. seasonal events: fireflies in June, summer fireworks, typhoon days ----------
    function seeded(d, salt) { var k = K.ymd(d) + salt, h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return (h % 1000) / 1000; }
    function isTyphoon(d) { d = d || new Date(); var m = d.getMonth() + 1; return (m === 9 || m === 10) && seeded(d, 'ty') < 0.08; }
    function fireworksDay(d) { d = d || new Date(); var m = d.getMonth() + 1, dd = d.getDate(); return (m === 7 && dd >= 15 && d.getDay() === 6) || (m === 8 && d.getDay() === 6) || (m === 8 && dd === 15) || (m === 12 && dd === 31) || (m === 1 && dd === 1); }
    function fireworksOn() { var d = new Date(), h = d.getHours() + d.getMinutes() / 60, m = d.getMonth() + 1; if (!fireworksDay(d)) return false; return m === 12 || m === 1 ? h >= 23.9 || h < 0.6 : h >= 19.8 && h < 22; }
    EXT.events.push(function (d) {
      var out = [], m = d.getMonth() + 1, dd = d.getDate();
      if ((m === 6) || (m === 7 && dd <= 10)) out.push('fireflies');
      if (fireworksDay(d)) out.push('fireworks');
      if (isTyphoon(d)) out.push('typhoon');
      return out;
    });
    setInterval(function () { SCENE.setFireworks && SCENE.setFireworks(fireworksOn()); }, 15000);
    function typhoonTick() {
      if (!isTyphoon() || !S().owned.house || BODY.place === 'house' || K.busy || !visible()) return;
      var h = K.hourOf(); if (h >= 9 && h < 22 && BODY.state === 'awake' && K.goPlace) K.goPlace('house', true);
    }

    // ---------- 27. studying together: a focus timer ----------
    var DISTRACT = /tiktok|musically|instagram|facebook|twitter|com\.x\.|snapchat|reddit|youtube|netflix|twitch|discord|pinterest|tumblr|crunchyroll|9gag|roblox|supercell|genshin|hoyoverse|mihoyo|game/i;
    function focusOn() { var f = S().focus; return !!(f && now() < f.until); }
    function startFocus(min) {
      var s = S(), t = now(); min = K.clampN(Math.round(min || 25), 5, 120);
      s.focus = { at: t, until: t + min * 60000, min: min, strikes: 0, away: 0 }; K.save(); emit('focus');
      BODY.activity((S().owned.books || 0) > 0 ? 'read' : 'sketch'); sayP(ML.focus.start, { min: min }, 'content');
      var a = an(); if (a && a.notifyAt) try { a.notifyAt(min * 60, 'Pusheen', T('Focus done. Break time.')); } catch (e) {}
    }
    function stopFocus(done) {
      var s = S(), f = s.focus; if (!f) return; s.focus = null; K.save(); emit('focus');
      if (!done) { K.feel('disappointed', 30); sayP(ML.focus.quit, null, 'away'); return; }
      var clean = !f.strikes, pts = Math.round(f.min / 25 * (clean ? 8 : 4)); s.focusPts = s.focusPts && s.focusPts.d === day() ? s.focusPts : { d: day(), n: 0 };
      pts = Math.max(0, Math.min(pts, 40 - s.focusPts.n)); s.focusPts.n += pts; s.points += pts;
      K.opinion(clean ? 1.2 : 0.3, 'we studied together'); K.warm(clean ? 0.2 : 0.05, 'we studied together'); K.emit('points'); K.save();
      if (clean) BODY.perform(['cheer']);
      sayP(clean ? ML.focus.done : ML.focus.doneMeh, null, clean ? 'happy' : 'content', clean ? 'sparkle' : null);
    }
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      var f = S().focus;
      if (document.hidden) { hiddenAt = now(); if (f && now() < f.until) { var a = an(); if (a && a.notifyAt && !f.warned) { f.warned = true; try { a.notifyAt(75, 'Pusheen', T('Come back. We\'re studying.')); } catch (e) {} } } return; }
      if (!f || !hiddenAt) { setTimeout(function () { mailTick(null); }, 2500); return; }
      var away = now() - hiddenAt; hiddenAt = 0; f.warned = false;
      if (now() >= f.until) { setTimeout(function () { stopFocus(true); }, 1500); return; }
      if (away < 20000) return;
      f.away += away;
      var apps = [], a2 = an();
      if (a2 && a2.appsSince) try { apps = JSON.parse(a2.appsSince(Math.round((now() - away) / 1000) * 1000)) || []; } catch (e) { apps = []; }
      var bad = apps.filter(function (x) { return x.ms > 20000 && (DISTRACT.test(x.pkg || '') || x.cat === 'game' || x.cat === 'social' || x.cat === 'video'); }).sort(function (x, y) { return y.ms - x.ms; })[0];
      setTimeout(function () {
        if (bad) { f.strikes++; K.opinion(-0.8, 'they opened ' + bad.label + ' during our focus'); K.heat(0.12, 'you opened ' + bad.label + ' while we were studying'); sayP(ML.focus.caught, { app: bad.label }, 'annoyed'); }
        else if (!apps.length && away > 120000) { f.strikes++; sayP(ML.focus.away, { mins: Math.round(away / 60000) }, 'annoyed'); }
        else sayP(ML.focus.back, null, 'neutral');
        K.save();
      }, 1200);
    });
    setInterval(function () { var f = S().focus; if (f && visible() && now() >= f.until) stopFocus(true); emit('focusTick'); }, 1000);
    EXT.routine.push(function () {
      if (focusOn()) return { id: 'study', prop: (S().owned.books || 0) > 0 ? 'read' : 'sketch' };
      if (isSick() && S().owned.house && S().owned.futon) { var h = K.hourOf(); if (h >= 8 && h < 22) return { id: 'sick', prop: null }; }
      return null;
    });

    // ---------- 31. she quizzes you on the week's topic ----------
    function quizTick() {
      var s = S(), t = now(), dk = day();
      if (!visible() || BODY.state !== 'awake' || K.busy || K.uiBusy() || focusOn() || silent() || s.askQ && t - s.askQ.at < 15 * 60000) return;
      if (t - K.lastPlayerAt > 8 * 60000 || t - K.lastPlayerAt < 50000) return;
      s.qz = s.qz && s.qz.d === dk ? s.qz : { d: dk, n: 0 }; if (s.qz.n >= 2 || t - (s.qz.last || 0) < 90 * 60000 || !chance(0.12)) return;
      var st = s.study; if (!st || st.week !== K.weekKey()) return;
      var tp = K.studyTopic(st), C = s.cards || {}, mine = Object.keys(C).filter(function (k) { return C[k].t === tp.id; });
      if (K.brainKind() !== 'off' && st.texts && st.texts.length && chance(0.3)) {
        var tx = pickL(st.texts); s.askQ = { teach: tx.title, at: t }; s.qz.n++; s.qz.last = t; K.save();
        sayP(ML.quiz.teach, { t: tx.title }, 'neutral'); return;
      }
      if (!mine.length) return;
      mine.sort(function (a, b) { return C[a].box - C[b].box || (C[a].at || 0) - (C[b].at || 0); });
      var id = mine[0], c = C[id]; s.askQ = { id: id, q: c.q, a: c.o[0], at: t }; s.qz.n++; s.qz.last = t; K.save();
      sayP(ML.quiz.ask, { q: c.q }, 'neutral');
    }
    function norm(x) { return String(x || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
    var STOP = /^(the|a|an|of|and|to|in|on|at|it|is|was|by|for|with|from|le|la|les|de|des|du|et|un|une)$/;
    function judgeLocal(ans, right) {
      var a = norm(ans), r = norm(right); if (!a) return false;
      if (a.indexOf(r) >= 0 || (r.length > 3 && r.indexOf(a) >= 0 && a.length >= r.length * 0.5)) return true;
      var nums = r.match(/\d+/g); if (nums && nums.every(function (n) { return a.indexOf(n) >= 0; })) return true;
      var toks = r.split(' ').filter(function (w) { return w.length >= 3 && !STOP.test(w); }); if (!toks.length) return false;
      return toks.filter(function (w) { return a.indexOf(w) >= 0; }).length / toks.length >= 0.6;
    }

    // ---------- hooks into her brain ----------
    EXT.mute.push(function () { return silent() || focusOn(); });
    EXT.gag.push(silent);
    EXT.local.push(function (text) {
      var s = S();
      if (silent()) {
        var x = s.silent;
        if (APOLOGY.test(text)) {
          x.tries++; var li = K.levelIdx(s.op), ok = (text.length >= 14 || x.tries >= 2) && chance(li >= 6 ? 0.8 : 0.55);
          setTimeout(function () { if (ok) { endSilent(true); sayP(ML.grudge.forgive, null, 'down'); } else K.say(pickL(ML.grudge.notEnough), 'away', null, { force: true }); }, 900);
        } else setTimeout(function () { K.say(pickL(ML.grudge.silentReply), 'away'); }, 900);
        return true;
      }
      if (APOLOGY.test(text) && s.forgivenAt && now() - s.forgivenAt < 3 * 60000 && !openGrudges().length) { setTimeout(function () { K.say(T('It\'s fine. ‖ I said it\'s fine.'), 'content'); }, 700); return true; }
      if (APOLOGY.test(text)) {
        var g = openGrudges().filter(function (x) { return x.told > 0 || now() - x.at < 3600e3; }).pop();
        if (g) { g.ok = true; K.opinion(1, 'they apologised'); K.save(); setTimeout(function () { sayP(ML.grudge.oldDone, null, 'content'); }, 800); return true; }
      }
      if (s.askQ && now() - s.askQ.at < 15 * 60000 && s.askQ.id) {
        var q = s.askQ, ok2 = judgeLocal(text, q.a); s.askQ = null; K.studyAnswer(q.id, ok2); K.save();
        setTimeout(function () { sayP(ok2 ? ML.quiz.right : ML.quiz.wrong, { a: q.a }, ok2 ? 'happy' : 'neutral'); }, 800);
        return true;
      }
      if (focusOn() && chance(0.7)) { setTimeout(function () { sayP(ML.focus.reply, null, 'neutral'); }, 700); return true; }
      return false;
    });
    EXT.fields.push('"forgive": true only if they just apologised sincerely for something you hold against them (see "Things you hold against them"); otherwise omit');
    EXT.fields.push('"grudge": null or {"what": "short, from your side, e.g. \\"you called my garden boring\\"", "weight": 1-3} — only when they did or said something that genuinely hurt you and you will hold it against them (rare)');
    EXT.fields.push('"quiz_ok": null, or true/false when their latest message answers the quiz question or explanation you asked for (see RIGHT NOW)');
    EXT.fields.push('"photo_caption": null, or 3-8 words describing the photo they just sent (only when they sent one)');
    EXT.reply.push(function (r) {
      var s = S();
      if (r.forgive === true) {
        if (silent()) endSilent(true);
        var g = openGrudges().pop(); if (g) { g.ok = true; K.opinion(0.8, 'they apologised'); }
      } else if (silent()) {
        if (String(r.say || '').replace(/[.…\s]/g, '').length > 14) r.say = pickL(ML.grudge.silentReply);
        r.offer = null; r.moves = []; r.mission = null; r.face = 'away'; r.act = 'sulk';
      }
      if (r.grudge && r.grudge.what) addGrudge(String(r.grudge.what), +r.grudge.weight || 1);
      if (r.quiz_ok != null && s.askQ) { if (s.askQ.id) K.studyAnswer(s.askQ.id, !!r.quiz_ok); s.askQ = null; }
      if (r.photo_caption && typeof r.photo_caption === 'string') {
        var w = lsGet(LS_WALL, []), last = w[w.length - 1];
        if (last && !last.cap && now() - last.at < 5 * 60000) { last.cap = r.photo_caption.slice(0, 60); lsSet(LS_WALL, w); K.remember('They showed me a photo: ' + last.cap + '. It\'s on my wall now.', 1); }
      }
      K.save();
    });
    EXT.lines.push(function () {
      var s = S(), out = [], t = now();
      if (silent()) out.push('- IMPORTANT: you are giving them the silent treatment because ' + s.silent.why + ' (about ' + Math.max(1, Math.round((s.silent.until - t) / 60000)) + ' more minutes). Unless their latest message is a sincere apology, "say" must be only "…" or two or three cold words. If they apologise sincerely, set "forgive": true and talk normally again (you may still be a little stiff).');
      var og = openGrudges(); if (og.length) out.push('- Things you hold against them (not apologised for): ' + og.map(function (g) { return '"' + g.what + '" (' + K.ago(t - g.at) + ' ago)'; }).join('; ') + '. You can bring one up days later, coldly or sadly. A sincere apology settles it (set "forgive").');
      if (isSick()) out.push('- You have a cold (day ' + (1 + Math.floor((t - s.sick.since) / 864e5)) + '): sniffly, a bit slow, you sneeze sometimes. You are not dramatic about it. Warm tea helps (they can buy ginger tea in the shop).');
      var hb = habits(); if (hb.length) out.push('- Habits you have noticed about them: ' + hb.map(function (h) { return h.text; }).join('; ') + '.');
      var ht = habitToday(); if (ht.length) out.push('- Today compared to their habits: ' + ht.map(function (h) { return h.text; }).join('; ') + '.');
      var gi = goalInfo(); if (gi) out.push('- You are saving up for a ' + goalDef(gi.id).name.toLowerCase() + ' (' + gi.saved + '/' + gi.price + ') with your own little income (2 per mission they finish, a bit from games, 2 a day). They can chip in from the notebook. You are quietly proud of it; mention it rarely.');
      var owned = GOALS.filter(function (g) { return s.owned[g.id]; }).map(function (g) { return g.name.toLowerCase(); }); if (owned.length) out.push('- Things you bought yourself with your savings: ' + owned.join(', ') + '.');
      if (V.cat) out.push('- A stray cat' + (s.cat && s.cat.name ? ' (' + s.cat.name + ', you named it; they fed it ' + s.cat.fed + ' times)' : '') + ' is in the garden right now.');
      if (V.tanuki) out.push('- A tanuki is crossing the garden right now.');
      var pl = Object.keys(s.plants || {}).map(function (id) { var p = s.plants[id], w = wiltOf(p); return plantName(id) + ' (' + (p.grow < 1 ? Math.round(p.grow * 100) + '% grown' : 'fully grown') + (w >= 1 ? ', wilted' : w >= 0.6 ? ', wilting' : w > 0 ? ', thirsty' : '') + ')'; });
      if (pl.length) out.push('- Your plants: ' + pl.join(', ') + '. They need water every couple of days; they can tap a plant to water it.');
      var um = unreadMail(); if (um) out.push('- There is unread mail in your mailbox for them (' + um + ').');
      var lastL = (s.mail || []).filter(function (m) { return m.kind === 'mine'; }).pop(); if (lastL && t - lastL.at < 3 * 864e5) out.push('- They wrote you a letter ' + K.ago(t - lastL.at) + ' ago. You answer letters by letter, a day later.');
      if (focusOn()) out.push('- You are studying together right now (focus timer, ' + Math.ceil((s.focus.until - t) / 60000) + ' min left). Keep replies to a few words and push them back to work.');
      if (s.askQ && t - s.askQ.at < 15 * 60000) out.push(s.askQ.id ? '- ' + K.ago(t - s.askQ.at) + ' ago you asked them a quiz question about this week\'s topic: "' + s.askQ.q + '" (correct answer: "' + s.askQ.a + '"). If their latest message answers it, judge leniently (meaning, not wording): set "quiz_ok", react in character, and if wrong give the right answer briefly.'
                                                                   : '- ' + K.ago(t - s.askQ.at) + ' ago you asked them to explain "' + s.askQ.teach + '" to you as if you did not know. Judge their explanation kindly but honestly (set "quiz_ok"), and add one thing they missed.');
      var ev = K.eventsToday(); if (ev.indexOf('typhoon') >= 0) out.push('- It\'s a typhoon day in your garden: wind and rain, you stay in if you can.');
      if (ev.indexOf('fireworks') >= 0 && fireworksOn()) out.push('- Fireworks are going off over Fuji right now.');
      if (ev.indexOf('fireflies') >= 0) out.push('- It\'s firefly season: at night they glow over your garden.');
      return out;
    });
    EXT.idle.push(function () {
      var out = [], s = S();
      if (isSick()) out = out.concat(ML.sick.idle);
      var hl = habitLine(); if (hl) return [[hl], 4];
      var gl = oldGrudgeLine(); if (gl) return [[gl], 6];
      var tp = thirstyPlant(); if (tp && (s.plantNag || 0) < now() - 3 * 3600e3 && BODY.place !== 'house') { s.plantNag = now(); return [[fill(pickL(tp.w >= 0.6 ? ML.plants.wilt : ML.plants.thirsty), { plant: T(plantName(tp.id)) })], 5]; }
      var gi = goalInfo(); if (gi && chance(0.15)) out.push(fill(pickL(ML.goal.idle), { item: gi.name, saved: gi.saved, price: gi.price }));
      if (s.goal && !s.goal.told && gi) { s.goal.told = true; K.save(); return [[fill(pickL(ML.goal.start), { item: gi.name, why: gi.why })], 8]; }
      return out.length ? [out, 2] : null;
    });
    EXT.arrive.push(function (queue, away, first) {
      if (first) return;
      habRecordOpen(); sickTick(); plantsTick(); goalTick();
      mailTick(queue);
      tellDream(queue);
      var gl = away > 12 * 3600e3 ? oldGrudgeLine() : null; if (gl) queue.push([gl, 'away']);
      var hl = habitLine(); if (hl) queue.push([hl, null]);
      if (isSick() && !queue.length) queue.push([pickL(ML.sick.idle), 'down']);
    });

    // a save was loaded: her photos and the floating head come back with it
    BRAIN.on(function (type) { if (type === 'imported') { pushWall(); syncOverlay(); emit('wall'); } });

    // ---------- taps on the garden: the cat, the mailbox, a plant ----------
    BODY.on(function (type, d) {
      if (type !== 'tapWorld' || !SCENE.hit) return;
      var h = SCENE.hit(d.x, d.y, BODY.place); if (!h) return;
      if (h === 'cat') tapCat();
      else if (h === 'mailbox') { emit('openMail'); }
      else if (h.indexOf('plant:') === 0) waterPlant(h.slice(6), false);
    });

    // ---------- 32. her head over other apps (Android does the watching; she gives it her lines) ----------
    var LS_OV = 'pusheen.overlay';
    function overlayCfg() { return lsGet(LS_OV, { on: false, min: 30 }); }
    function syncOverlay() { var a = an(); if (!a || !a.setOverlay) return; var c = overlayCfg(); try { a.setOverlay(JSON.stringify({ on: !!c.on, min: c.min || 30, lines: ML.overlay.map(function (x) { return x.replace(/\s*‖\s*/g, ' '); }) })); } catch (e) {} }
    function setOverlay(o) { lsSet(LS_OV, Object.assign(overlayCfg(), o)); syncOverlay(); }

    // ---------- ticking ----------
    function tick10() { if (document.hidden) return; sickTick(); plantsTick(); goalTick(); visitorsTick(); typhoonTick(); maybeSelfWater(); mailTick(null); habRecordOpen(); }
    function start() {
      habRecordOpen(); sickTick(); plantsTick(); pushWall(); pushMail(); visitorsTick(); goalTick(); syncOverlay();
      SCENE.setFireworks && SCENE.setFireworks(fireworksOn());
      if (BODY.state === 'asleep') makeDream(false);
      setInterval(tick10, 60000);
      setInterval(function () { if (!document.hidden) { visitorsTick(); photoTick(); quizTick(); if (BODY.state === 'asleep') BODY.setDream && BODY.setDream(dreamSymbols()); } }, 30000);
      setInterval(function () { if (V.cat || V.birds || V.tanuki) pushVisitors(); }, 1000);
    }

    return {
      on: function (fn) { listeners.push(fn); }, start: start, overlay: overlayCfg, setOverlay: setOverlay,
      sick: isSick, silent: silent, habits: function () { return habits().map(function (h) { return h.text; }); },
      goal: goalInfo, helpGoal: helpGoal, goals: function () { return GOALS.map(function (g) { return { id: g.id, name: T(g.name), owned: !!S().owned[g.id] }; }); },
      focus: function () { var f = S().focus; return f && now() < f.until ? { left: f.until - now(), min: f.min, strikes: f.strikes } : null; }, startFocus: startFocus, stopFocus: function () { stopFocus(false); },
      mail: mailList, readMail: readMail, writeLetter: writeLetter, unread: unreadMail,
      album: album, albumImg: albumImg, wall: function () { return lsGet(LS_WALL, []).slice().reverse(); },
      cat: function () { return S().cat; }, snap: snap, water: waterPlant, tapCat: tapCat,
      dream: function () { return S().dream; }, grudges: openGrudges, addGrudge: addGrudge, tellDream: function () { tellDream(null); }, makeDream: makeDream,
      _test: { V: V, visitorsTick: visitorsTick, plantsTick: plantsTick, goalTick: goalTick, quizTick: quizTick, tripCheck: tripCheck, mailTick: mailTick, habits: habits, habitToday: habitToday, startSilent: startSilent, sickTick: sickTick, handleRule: handleRule, isTyphoon: isTyphoon, fireworksOn: fireworksOn, ML: ML }
    };
  })();
