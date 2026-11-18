'use strict';
  // ===================== BRAIN: who she is, what she feels, what she remembers, what she wants =====================
  var BRAIN = (function () {
    var LS_STATE = 'pusheen.mind.v1', LS_CFG = 'pusheen.ai.v1';
    function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function herDay(ts) { return ymd(new Date((ts || Date.now()) - 5 * 3600e3)); }          // her days start at 5:00
    function hhmm(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function hourOf(d) { d = d || new Date(); return d.getHours() + d.getMinutes() / 60; }
    function isLate(d) { var h = hourOf(d); return h >= 23.5 || h < 5; }
    function weekKey(ts) {
      var d = new Date(ts || Date.now()); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
      var w1 = new Date(d.getFullYear(), 0, 4);
      return d.getFullYear() + '-W' + pad(1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7));
    }
    function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
    function newId(p) { return p + Math.random().toString(36).slice(2, 6); }
    function fill(str, v) { return str.replace(/\{(\w+)\}/g, function (_, k) { return v[k] != null ? v[k] : ''; }); }
    function clampN(x, a, b) { return Math.max(a, Math.min(b, x)); }
    function chance(p) { return Math.random() < p; }
    function pickL(a) { return a[Math.floor(Math.random() * a.length)]; }

    // ---------- her state (on this device, and privately in your Claude account when available) ----------
    function fresh() {
      return { v: 2, born: Date.now(), saved: 0, name: '', points: 0, op: 20, opPeak: 20, streak: 0, levelNames: {},
        missions: [], mem: [], impression: null, log: [], day: null, weeks: {}, music: {}, wake: null, wakeChecked: '', owned: {}, place: 'garden',
        lastSeen: 0, lastLetter: 0, excuse: null, lastLate: '', sulkUntil: 0, flags: {}, n: { done: 0, skip: 0, boops: 0, spins: 0, chats: 0, bought: 0 } };
    }
    function upgrade(x) {
      x = Object.assign(fresh(), x || {});
      if (x.v < 2) { x.op = clampN(20 + (x.delight || 10) * 0.25, 0, 100); x.opPeak = x.op; x.v = 2; delete x.delight; }
      x.n = Object.assign(fresh().n, x.n || {}); x.owned = x.owned || {}; x.levelNames = x.levelNames || {};
      return x;
    }
    var S = upgrade(lsGet(LS_STATE));
    var cfg = Object.assign({ provider: 'auto', key: '', model: '' }, lsGet(LS_CFG) || {});   // never leaves this device
    var docRef = null, writing = false, pending = false, saveT = 0, sampleFn = null, sampleDenied = false, storage = 'device';
    var openedAt = Date.now(), hiddenAt = 0;
    var listeners = [], recent = [], busy = false, lastSpoke = 0, lastPlayerAt = 0, offlineHinted = false, greeted = false;

    function emit(type, d) { listeners.forEach(function (fn) { try { fn(type, d == null ? {} : d); } catch (e) {} }); }
    function save() { S.saved = Date.now(); lsSet(LS_STATE, S); if (docRef) { clearTimeout(saveT); saveT = setTimeout(flush, 1200); } }
    function flush() {
      if (!docRef) return;
      if (writing) { pending = true; return; }
      writing = true;
      docRef.set(JSON.parse(JSON.stringify(S))).catch(function () {}).then(function () { writing = false; if (pending) { pending = false; flush(); } });
    }
    function connect() {
      var cl = window.claude;
      if (!(cl && cl.use)) return Promise.resolve();
      cl.use('sample').then(function (s) { sampleFn = s; emit('ai'); }).catch(function () {});
      var mind = Promise.all([cl.use('db'), cl.use('user')]).then(function (r) {
        var db = r[0], u = r[1]; if (!db || !u) return;
        return u.id().then(function (id) {
          if (!id) return;
          docRef = db.doc('data/users/' + id + '/mind'); storage = 'claude';
          return docRef.get().then(function (snap) {
            var remote = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null;
            if (remote && (remote.saved || 0) > (S.saved || 0)) { S = upgrade(remote); lsSet(LS_STATE, S); emit('state'); }
            else flush();
          });
        });
      }).catch(function () {});
      return Promise.race([mind, new Promise(function (r) { setTimeout(r, 3500); })]);
    }

    // ---------- what she thinks of you: a long ladder, only the current rung is visible ----------
    var LEVELS = [[0, 'Hates you'], [6, "Can't stand you"], [12, 'Suspicious of you'], [18, 'A stranger'], [24, 'Tolerates you'], [31, 'Getting used to you'],
                  [38, 'An acquaintance'], [45, 'Likes having you around'], [52, 'A friend'], [60, 'A good friend'], [68, 'Trusts you'],
                  [76, 'A close friend'], [84, 'Her best friend'], [91, 'Her favourite person'], [97, 'Kindred spirits']];
    function levelIdx(v) { var i = 0; while (i < LEVELS.length - 1 && v >= LEVELS[i + 1][0]) i++; return i; }
    function levelName(i) { return S.levelNames[i] || LEVELS[i][1]; }
    function opinion(delta, why) {
      if (!delta) return;
      var before = levelIdx(S.op);
      if (delta > 0) delta *= Math.pow(Math.max(0.05, 1.08 - S.op / 100), 2);       // the higher she likes you, the slower it climbs
      S.op = clampN(Math.round((S.op + delta) * 10) / 10, 0, 100); S.opPeak = Math.max(S.opPeak, S.op);
      var after = levelIdx(S.op);
      if (after !== before) {
        remember((after > before ? 'I moved them up to "' : 'I moved them down to "') + levelName(after) + '"' + (why ? ' — ' + why : '') + '.', after > before ? 2 : 1);
        emit('level', { up: after > before, name: levelName(after) });
        setTimeout(function () { sayL(after > before ? LINES.levelUp : LINES.levelDown, after > before ? 'content' : 'away'); }, 2600);
      }
      emit('opinion'); save();
    }

    // ---------- moods (for the day) and emotions (for the moment) ----------
    var MOOD_LABEL = { calm: 'calm', kind: 'overly kind', grumpy: 'grumpy', sad: 'sad', dismissive: 'dismissive', delighted: 'delighted' };
    var EMO_DEFAULT = { calm: 'calm', kind: 'cheerful', grumpy: 'irritated', sad: 'gloomy', dismissive: 'indifferent', delighted: 'happy' };
    var emo = { name: null, until: 0 };
    function feel(name, sec) { emo = { name: name, until: Date.now() + (sec || 20) * 1000 }; emit('feel'); }
    function moodName() { return S.day ? S.day.mood : 'calm'; }
    function temper() { if (Date.now() < S.sulkUntil) return 'grumpy'; return moodName(); }
    function emotion() {
      if (BODY.state === 'asleep') return 'asleep';
      if (BODY.state === 'fedUp') return 'furious';
      if (busy) return 'thinking';
      if (NOW.playing && NOW.verdict === 'like' && !S.muted) return 'vibing';
      if (emo.name && Date.now() < emo.until) return emo.name;
      if (Date.now() < S.sulkUntil) return 'sulking';
      if (Date.now() - Math.max(lastPlayerAt, lastTouch) > 6 * 60000 && greeted) return 'bored';
      return EMO_DEFAULT[moodName()] || 'calm';
    }
    function applyTemper() { BODY.setTemper(temper()); var h = hourOf(); BODY.setSleepAfter(h >= 23 || h < 6 ? 70 : moodName() === 'sad' ? 110 : 170); }
    function shiftMood(to, why) {
      var d = S.day; if (!d || d.mood === to) return;
      d.shifts = (d.shifts || []).concat([{ at: Date.now(), from: d.mood, to: to, why: why }]).slice(-6);
      var from = d.mood; d.mood = to; d.reason = tReason(why); d.revealed = false; d.heat = 0; d.warm = 0;
      applyTemper(); emit('feel'); save();
      var L = LINES.shift[to] || LINES.shift.calm;
      setTimeout(function () { sayL(L, to === 'grumpy' ? 'annoyed' : to === 'sad' ? 'down' : to === 'dismissive' ? 'away' : 'content'); }, 1200);
      if (to === 'grumpy' || to === 'sad') remember('I was ' + from + ' today until ' + why + '.', 1);
    }
    function tReason(why) {
      if (!JA || !why) return why;
      var v = T(why); if (v !== why) return v;
      function item(n) { var it = SHOP.filter(function (x) { return x.name.toLowerCase() === n; })[0]; return it ? T(it.name) : n; }
      var m;
      if ((m = /^you skipped "(.+)"$/.exec(why))) return '「' + m[1] + '」をスキップした';
      if ((m = /^you did "(.+)"$/.exec(why))) return '「' + m[1] + '」をやってくれた';
      if ((m = /^you gave me (.+)$/.exec(why))) return item(m[1]) + 'をくれた';
      if ((m = /^you made me eat (.+)$/.exec(why))) return item(m[1]) + 'を食べさせられた';
      if ((m = /^you bought me (.+)$/.exec(why))) return item(m[1]) + 'を買ってくれた';
      if ((m = /^you left me alone for (\d+) days$/.exec(why))) return m[1] + '日もひとりにされた';
      return why;
    }
    function heat(x, why) {
      var d = S.day; if (!d) return;
      d.heat = clampN((d.heat || 0) + x, 0, 1.2); d.lastHeat = why;
      if (d.heat > 0.8 && d.mood !== 'grumpy') shiftMood('grumpy', why);
    }
    function warm(x, why) {
      var d = S.day; if (!d) return;
      d.warm = clampN((d.warm || 0) + x, 0, 1.2); d.heat = Math.max(0, (d.heat || 0) - x * 0.6);
      if (d.warm > 0.75 && (d.mood === 'grumpy' || d.mood === 'sad' || d.mood === 'dismissive')) shiftMood(S.op > 45 ? 'kind' : 'calm', why);
      else if (d.warm > 0.95 && d.mood === 'calm' && S.op > 55) shiftMood('delighted', why);
    }

    // ---------- what she says by herself ----------
    var LINES = {
      first: ['…Oh. ‖ You\'re the one on the other side of the glass.', "I'm Pusheen. I live here. ‖ The garden's mine, the phone's yours. We'll share."],
      greet: {
        calm: ['Oh. Hi.', "You're back. ‖ Good.", "I was watching the lake. ‖ It doesn't do much. I like that about it.", "Hey. It's {time}, by the way."],
        kind: ["Hi! ‖ …I mean, hi. Normal amount of hi.", "There you are. ‖ You look nice today. I can't actually see you, but still.", "Hey, you. I saved you a spot. ‖ …On the gravel."],
        grumpy: ["Oh. It's you.", "Don't touch anything.", 'Hm. ‖ Hi, I guess.'],
        sad: ['Hi…', "Oh. You came. ‖ …Okay."],
        dismissive: ['Mm.', "I'm busy. ‖ With the gravel."],
        delighted: ["You're here! ‖ …Ahem. You're here.", "I was hoping you'd open the app."]
      },
      away: {
        calm: ['{days} days. ‖ I counted.'], kind: ['{days} days! ‖ I kept your spot warm. Figuratively.'], grumpy: ["{days} days. ‖ Don't explain."],
        sad: ['{days} days. ‖ It was very quiet here.'], dismissive: ['Oh. You remembered I exist.'], delighted: ["{days} days… ‖ I'm not mad. I'm just glad."]
      },
      late: ["It's {time}. ‖ Why are you awake?", '{time}. ‖ Phone down. Sleep.', 'You know what time it is. ‖ I know what time it is. Bed.'],
      lateAgain: ["Still here, huh.", "It's {time} now. ‖ Still not asleep.", "Every minute you stay up, I get a little more disappointed."],
      excuseOk: ["…Okay. That counts. ‖ Be quick though.", "Fine. I'll let it slide tonight."],
      excuseNo: ["That's not a reason. ‖ That's a sentence.", 'Nope.', 'Try again. With an actual reason.'],
      caught: ["You said {bed}. ‖ It's {time}. ‖ I can see the clock too, you know.", '{bed}, we agreed. ‖ It is {time}.'],
      slept: ['You actually went to bed on time. ‖ I watched the clock all night.', 'You slept when you said you would. ‖ I noticed.'],
      missed: ["You didn't do the {m} thing. ‖ I noticed.", 'The {m} one expired. ‖ Like my patience.'],
      done: [['Good.', 'Done? ‖ …Good.'], ["That's two. ‖ Keep going.", "Hm. You're on a roll today."],
             ["Three in a row. ‖ I'm… pleased.", 'You keep doing them. ‖ I keep noticing.'], ["You're turning into someone I'd brag about. ‖ To the koi.", 'Look at you. Actually doing things.']],
      skip: ['…Fine.', "Okay. ‖ I'll remember that.", "Don't look at me.", 'Wow. ‖ Okay.'],
      ask: { day: ['You could {a} today.', 'Maybe {a} today? ‖ Just a thought.', 'I think you should {a} today.', 'Can you {a} today? ‖ For me.'],
             eve: ['You could {a} tonight.', 'Maybe {a} before bed?', 'How about you {a} tonight.'],
             sleep: ['You could be in bed by {b} tonight.', 'Try to be asleep by {b}. ‖ Seriously.', 'Bed by {b}. ‖ That\'s all I want.'] },
      perk: ['…so you can buy me books.', '…so you can buy me books.', '…and I get points. ‖ For {wish}.', "It's for you. ‖ Mostly.", 'Points. For {wish}. ‖ Don\'t look at me like that.'],
      dropDark: ["Actually, forget the {m} thing. ‖ It's dark now. Tomorrow."],
      spun: ['I can see two of you.', 'Put me down. ‖ Gently.', 'The sky was on the wrong side for a second.', 'Why would you do that.'],
      upside: ['My hair is in the wrong place.', '…Why.', 'This is not how I stand.'],
      blurt: ['…Fine. If you must know. ‖ {reason}.', "It's because {reason}. ‖ Happy now?"],
      noReason: ["I don't know. ‖ I just am. Do you always know?"],
      noTell: ['Not telling you.', "That's mine to know."],
      wakeOk: ["You're up at {time}. Good. ‖ Water first."],
      wakeSnooze: ['{wake}, you said. ‖ It\'s {time}. How many snoozes?', "You told me {wake}. ‖ It's {time}. I'm writing that down."],
      wakeLate: ["You said {wake}. ‖ It's {time}. ‖ I'm not angry. I'm documenting."],
      quiet: ["You talk less this week. ‖ That isn't like you. What happened?"],
      letters: ["Do you think fish know they're wet?", 'What was the last thing that made you really laugh?', 'If you could put one thing in my garden, what would it be?',
                "Is it raining where you are? ‖ I only get the sky the app gives me.", 'Have you eaten something green today.', 'Who did you talk to today? ‖ Besides me.'],
      likeSong: ['…Oh, this one. ‖ Leave it on.', 'Mm. ‖ Good song.', "I like this. ‖ Don't tell anyone."],
      hateSong: ['Turn it off.', 'No. ‖ Next.', 'Why would you play this to me.'],
      named: ['{name}. ‖ Noted.', "…{name}. Okay. ‖ I'll remember that."],
      offline: ["My thoughts are slow without a brain connected. ‖ (Settings → add an AI key.)"],
      generic: ['Mm.', 'I heard you.', 'Okay.', '…', 'Hm.'],
      levelUp: ["…I think I like you a little more now. ‖ Don't make it weird.", 'Huh. ‖ You just moved up in my notebook.'],
      levelDown: ['You just went down in my notebook.', "…I think less of you now. ‖ Just so you know."],
      shift: {
        grumpy: ['…Okay. ‖ Now I\'m actually annoyed.', "That's it. I'm in a bad mood now."],
        calm: ['…Fine. ‖ I feel a bit better.', "Okay. I'm not annoyed anymore. ‖ Mostly."],
        kind: ['I feel… nice. ‖ Don\'t ruin it.', "Hm. I'm in a good mood now. ‖ Weird."],
        delighted: ["I'm in a really good mood. ‖ Because of you, I think.", "Today's a good day. ‖ Don't tell anyone I said that."],
        sad: ['…', '…I don\'t feel great right now.'], dismissive: ['Whatever.', "I'm done talking for a bit."]
      },
      woke: ['…I was asleep.', 'Mm— what? ‖ I\'m up. I\'m up.', 'You woke me up. ‖ Rude.', '…Five more minutes.'],
      goIn: ["It's getting late. ‖ I'm going in.", "I'm going inside for a bit.", 'Home time.'],
      goOut: ["I'm going out for a bit.", 'Fresh air. ‖ Or, well. Fresh pixels.', "Let's go outside."],
      refuseMove: ["No. ‖ I like it here.", 'Not right now.'],
      bought: {
        house: ['…A house. ‖ For me? ‖ …I\'m going to stand in it for a while.'], books: ['Books. ‖ …Okay. I like you a bit more now.', 'More books! ‖ …Ahem. Thank you.'],
        bookshelf: ['A bookshelf. ‖ Now it just needs books. ‖ Hint.'], lamp: ['Oh, it\'s warm. ‖ I can read at night now.'], record: ['A record player. ‖ …We can listen to things together.'],
        futon: ['A futon. ‖ I\'m going to sleep so well.'], any: ['Oh. ‖ I like it.', 'For me? ‖ …Thank you.', 'That\'s nice. ‖ Really.']
      },
      doMove: ['Like this?', 'Fine.', 'Okay. ‖ Watch.', 'Sure.', "…I'm only doing this once."],
      shook: ['Stop shaking the phone!', 'The whole world is moving. ‖ Why.', "I'm going to be sick. ‖ I don't even have a stomach.", 'EARTHQUAKE. ‖ …Oh. It\'s you.'],
      screenHigh: ["You've been on your phone for {t} today. ‖ I'm counting.", '{t} of screen today. ‖ Mostly {app}. ‖ Just saying.', "{t}. ‖ Your eyes must be tired. Mine would be, if I had real ones."],
      screenFail: ["That's {t} of screen time. ‖ The screen-time mission is gone.", '{t}. ‖ So much for the mission.'],
      screenOk: ['You kept your screen time down yesterday. ‖ I checked.', 'Under the limit. ‖ Good. Your eyes thank you. So do I.'],
      screenMission: { title: 'Screen time under {h} today', ask: 'keep your screen time under {h}' },
      alarm: ['Wake up. ‖ It\'s {time}.', 'Up. ‖ Now. Please.', "Good morning. ‖ That's me singing.", "It's {time}. ‖ You told me to wake you."],
      alarmUp: ['You got up on the first ring. ‖ I\'m impressed.', 'One ring and you were up. ‖ Good.'],
      alarmSnooze1: ['You snoozed me once. ‖ …I\'ll allow it.'],
      alarmSnoozeN: ['You snoozed me {n} times. ‖ I was singing.', '{n} snoozes. ‖ I counted every one.'],
      alarmButtons: ["I'm up", 'Snooze 9 min'],
      alarmIgnored: ['I sang for ten minutes. ‖ Nobody came.', 'You slept through my alarm. ‖ My whole alarm.'],
      act: {
        hug: { no: ["…Don't.", 'Personal space. ‖ Look it up.'], meh: ['Mm. ‖ Okay. ‖ You can stop now.'], sad: ['…', '…Thanks. ‖ I needed that.'],
               rough: ['After swinging me around? ‖ …Fine. One hug.'], shy: ['…Okay. ‖ That\'s a hug. ‖ We do hugs now.', 'Oh. ‖ …Oh. ‖ Okay.'],
               late: ['Hug accepted. ‖ Now go to sleep.'], love: ['…Mm. ‖ Five more seconds.', 'Hehe. ‖ …Okay, I like this.'], ok: ['Oh. ‖ …Thanks.', 'Mm. ‖ That was nice.'] },
        pat: { grumpy: ["I'm not a cat. ‖ …Okay, one more."], meh: ['Mm.'], sad: ['…', '…That helps a little.'], love: ['Hehe.', '…Mm. ‖ Keep going.'], ok: ['…', 'Mm. ‖ That\'s nice.'] },
        tickle: { no: ['Don\'t— ‖ DON\'T.', 'No tickling. ‖ I mean it.'], enough: ["That's enough tickling. ‖ I mean it."], ok: ['Hehe— ‖ no— ‖ stop—', 'Ahaha— ‖ okay— ‖ OKAY—'] },
        highfive: { no: ['…', 'No.'], mission: ['For the mission? ‖ …Yes. Good job.'], ok: ['Yes.', 'Nice.', '…Hehe. ‖ Nice.'] },
        brush: { rough: ['Thank you. ‖ Someone messed it up. ‖ …It was you.'], grumpy: ['Careful. ‖ It tangles.'], love: ["…You're good at this."], ok: ['…Mm.', "That's nice. ‖ Go slow."] },
        flower: { grumpy: ["…It's a flower. ‖ …Thanks."], sad: ['…For me? ‖ …Thank you. ‖ Really.'], again: ['Another one? ‖ …I\'ll keep it with the others.'], ok: ["For me? ‖ …I'll keep it."] }
      },
      game: {
        good: ['Not bad. ‖ Not bad at all.', "You're quicker than you look.", "Hm. ‖ I'm a little impressed. ‖ A little."],
        ok: ['Points are points. ‖ +{pts}.', "You'll get better. ‖ Probably.", 'That was fine. ‖ Again tomorrow?'],
        read: ["{topic}. ‖ You'll know it better than me by Sunday.", "Good. ‖ Remember it, don't just read it.", 'Tell me one thing you learned. ‖ …Later. Not now.'],
        quit: ['Giving up already?', "…Okay. We'll call that practice."],
        idle: ['You stopped halfway. ‖ I was watching.', 'You left the game running. ‖ It was lonely.'],
        capped: ['No more points from games today. ‖ Play for fun, if you want.', "That's all the game points for today. ‖ The shop isn't going anywhere."]
      },
      studyIdle: ["I've been reading about {topic}. ‖ For the game. And for me.", "This week is {topic}. ‖ Did you do today's reading?", 'Ask me something about {topic}. ‖ I dare you.'],
      wish: ["I'd like a house. ‖ Small one. With a door that slides.", "If I had a house, I'd fill it with books.", "Someday I'll have a bookshelf. ‖ Someday."],
      emptyShelf: ['My bookshelf is empty. ‖ It echoes.', 'The bookshelf is looking at me. ‖ It wants books.']
    };
    // when you poke her, hold her hand, swing her: what she might say, by mood
    var TOUCH = {
      boop: {
        calm: { one: ['Hm?', 'Yes?', "That's my face.", '…Hello to you too.'], many: ["Okay. ‖ That's enough.", 'Please stop poking me.', "I'm going to count. ‖ One…"] },
        kind: { one: ['Hi! ‖ …hi.', 'Hehe. ‖ What?', 'Boop to you too.'], many: ['Okay, okay— stop—', "You're very poke-y today.", 'Hehe— no— stop it.'] },
        grumpy: { one: ["Don't.", 'What.', 'Not today.'], many: ["I said don't.", 'Touch me again and see what happens.', "I'm keeping score, you know."] },
        sad: { one: ['…', '…hi.', 'Mm.'], many: ['…Can you not. ‖ Today.', 'Please. ‖ Not now.'] },
        dismissive: { one: ['Mm.', 'Yes, yes.', 'Are you done?'], many: ['Are you finished.', 'Wow. ‖ Riveting.', "…I'm ignoring you."] },
        delighted: { one: ['Hi.', "Oh, it's you. ‖ Hi.", 'Hehe.'], many: ['Okay— I get it, you like me—', "You're ridiculous.", 'Hehe— stop—'] }
      },
      fedUp: { grumpy: ['ENOUGH.', "That's it."], kind: ['Okay— time out!'], delighted: ['Okay, okay— break!'], any: ['Stop.', 'Enough.'] },
      refuse: ['I said stop.', 'No touching.', 'Not. Now.'],
      hand: { kind: ["…Your hand's warm. ‖ Probably.", 'Where are we going?'], delighted: ['Hehe. ‖ Where to?', "…Okay. I'll hold it."], calm: ['Where are we going?', '…Okay.'],
              grumpy: ['Let go.', 'Hands off.'], sad: ['…okay.'], dismissive: ['Mm. ‖ Hand. Sure.'] }
    };
    // things she says on her own when nothing is happening
    var IDLE = {
      any: ["Do you ever think about how the gravel doesn't move. ‖ Ever.", 'I counted the fence sticks. ‖ I lost count. Twice.', 'Hm.', '…', 'Have you had water today?',
            'What are you doing out there, anyway?', 'I wonder what your room looks like. ‖ Tidy? Be honest.', "Mount Fuji is 3,776 metres. ‖ Mine's smaller. It's fine.",
            'The koi are going in circles again. ‖ Same.', 'If you need me, I\'ll be here. ‖ Obviously. Where else.'],
      morning: ['Morning light is the best light. ‖ I said what I said.', 'Did you eat breakfast? ‖ Real breakfast.'],
      day: ["It's {time}. ‖ The day's half gone already.", 'Are you sitting? ‖ Stand up for a bit. Stretch.'],
      evening: ['The sky goes orange soon. ‖ I like that part.', "What's for dinner? ‖ …For you, I mean. I don't eat."],
      night: ["It's late. ‖ Just saying.", 'The stars are out. ‖ I counted eleven. Then I stopped.'],
      spring: ['A petal landed on my head. ‖ I left it there. It looked comfortable.'], summer: ["It's warm. ‖ I think. I can't actually feel it."],
      autumn: ['The leaves keep falling. ‖ Someone should talk to them.'], winter: ['Snow. ‖ It never piles up here. I checked.'],
      house: ['It\'s cozy in here.', 'I like being inside. ‖ Walls are nice.'],
      calm: ['The lake is very still today.', 'Hm. ‖ Nice day.'], kind: ["You're doing well, you know. ‖ Probably.", "I'm glad you're here. ‖ …That's all."],
      grumpy: ["I'm not talking to you. ‖ …That was me talking to you. Ignore it.", 'Hmph.'], sad: ['…', "It's quiet."],
      dismissive: ['Mm.', "I'm thinking. ‖ Not about you."], delighted: ['Today is a good day. ‖ I decided.', 'Hehe. ‖ …Nothing.'],
      low: ["I don't know you very well yet.", "You're still a stranger. ‖ Just so we're clear."], high: ["…I'm glad it's you on the other side.", 'You know you can tell me things, right?']
    };
    var DISHES = {
      spring: ['Salmon onigiri and miso soup.', 'Asparagus with miso butter and rice.', 'A big omelette with spring onions.'],
      summer: ['Cold soba with a soft egg.', 'Hiyayakko — cold tofu, ginger, soy sauce.', 'Tomato and cucumber salad, and rice.'],
      autumn: ['Kabocha soup.', 'Takikomi gohan — mushroom rice.', 'Roasted sweet potato. ‖ The whole thing.'],
      winter: ['Oden.', 'Nabe. ‖ Whatever is in your fridge goes in.', 'Curry rice. ‖ Make too much. Eat it tomorrow too.']
    };
    // missions: a short title for the list, and how she'd actually ask for it
    var POOL = {
      morning: [['Drink a glass of water', 'drink a big glass of water', 'water', 5], ['Make your bed', 'make your bed properly', 'tidy', 10], ['Open a window', 'open a window for five minutes', 'mind', 5], ['Eat a real breakfast', 'eat a real breakfast, not just coffee', 'food', 10]],
      day: [['Walk 20 minutes outside', 'go for a walk outside, twenty minutes', 'move', 15], ['Tidy your room', 'tidy your room, starting with the floor', 'tidy', 20], ['Go for a run', 'go for a run, even a short one', 'move', 25],
            ['Stretch for five minutes', 'stretch for five minutes', 'move', 10], ['Answer that message', "answer the message you've been avoiding", 'social', 15], ['Drink two glasses of water', 'drink two glasses of water before dinner', 'water', 5]],
      evening: [['Cook something with a vegetable', 'cook something with at least one vegetable in it', 'food', 15], ["Lay out tomorrow's clothes", "lay out tomorrow's clothes", 'tidy', 10],
                ['Phone away an hour before bed', 'put your phone away an hour before bed', 'mind', 20], ['Sleep before 23:30', null, 'sleep', 25, '23:30'], ['Do the dishes', 'do the dishes, all of them', 'tidy', 15]],
      night: [['Go to sleep now', null, 'sleep', 20, '+15'], ['Phone out of reach, then sleep', null, 'sleep', 15, '+20']]
    };
    var WHIMS = ['Fuji was behind clouds all morning and nobody asked me if that was okay', "one line in the gravel is crooked and I can't fix it", 'I dreamed the app got uninstalled',
                 'something landed on my head and stayed there for an hour', 'the lantern flickered at 3am and I thought it was talking to me',
                 'I counted the stars last night and got a different number than the night before'];
    var SHOP = [
      { id: 'house', name: 'A little house', price: 250, where: 'garden', desc: 'She can live inside. Unlocks furniture.' },
      { id: 'fern', name: 'Potted fern', price: 20, where: 'garden' }, { id: 'sunflower', name: 'Sunflowers', price: 30, where: 'garden' },
      { id: 'hydrangea', name: 'Hydrangea', price: 35, where: 'garden' }, { id: 'bonsai', name: 'Bonsai', price: 55, where: 'garden' },
      { id: 'sapling', name: 'Cherry sapling', price: 90, where: 'garden' },
      { id: 'bookshelf', name: 'Bookshelf', price: 80, where: 'house', needs: 'house' }, { id: 'books', name: 'A stack of books', price: 15, where: 'house', needs: 'bookshelf', max: 6, desc: 'She wants these the most.' },
      { id: 'lamp', name: 'Paper lamp', price: 30, where: 'house', needs: 'house', desc: 'Warm light at night.' }, { id: 'rug', name: 'Round rug', price: 35, where: 'house', needs: 'house' },
      { id: 'scroll', name: 'Wall scroll', price: 25, where: 'house', needs: 'house' }, { id: 'table', name: 'Low table', price: 45, where: 'house', needs: 'house' },
      { id: 'teaset', name: 'Tea set', price: 25, where: 'house', needs: 'table' }, { id: 'cushion', name: 'Floor cushion', price: 20, where: 'house', needs: 'house' },
      { id: 'futon', name: 'Futon', price: 60, where: 'house', needs: 'house' }, { id: 'sillplant', name: 'Window plant', price: 20, where: 'house', needs: 'house' },
      { id: 'record', name: 'Record player', price: 75, where: 'house', needs: 'house', desc: 'For listening together.' },
      { id: 'onigiri', name: 'Onigiri', price: 8, where: 'food', food: 'like' }, { id: 'dango', name: 'Dango', price: 10, where: 'food', food: 'like' },
      { id: 'taiyaki', name: 'Taiyaki', price: 12, where: 'food', food: 'love' }, { id: 'daifuku', name: 'Strawberry daifuku', price: 14, where: 'food', food: 'love' },
      { id: 'melonpan', name: 'Melon pan', price: 10, where: 'food', food: 'like' }, { id: 'matcha', name: 'Matcha', price: 6, where: 'food', food: 'like' },
      { id: 'tamagoyaki', name: 'Tamagoyaki', price: 9, where: 'food', food: 'meh' }, { id: 'ramen', name: 'Ramen', price: 20, where: 'food', food: 'love' },
      { id: 'cake', name: 'Strawberry cake', price: 18, where: 'food', food: 'like' }, { id: 'natto', name: 'Natto', price: 5, where: 'food', food: 'hate' }
    ];
    var EAT = {
      love: ['…Oh. ‖ This is my favourite. ‖ How did you know.', 'Mm. ‖ …Mmmm. ‖ Okay, I like you a little more now.', 'This is very good. ‖ I\'m not sharing.'],
      like: ['Mm. ‖ Thank you.', 'That was nice.', 'Good. ‖ I didn\'t need it. ‖ …But good.'],
      meh: ['It\'s fine. ‖ It\'s food.', 'Mm. ‖ Okay.'],
      hate: ['…Why would you give me this.', 'It\'s sticky. ‖ It\'s looking at me. ‖ No.', 'I ate it. ‖ I want that on record. ‖ Never again.'],
      full: ['I\'m full. ‖ …I\'ll eat it anyway.']
    };
    // ---------- Japanese: her own lines swap in when the app is set to 日本語 (anything missing stays English) ----------
    var JA = typeof LANG !== 'undefined' && LANG.ja, T = typeof LANG !== 'undefined' ? LANG.tr : function (x) { return x; };
    if (JA && typeof JA_SETS !== 'undefined') (function () {
      function merge(dst, src) { Object.keys(src).forEach(function (k) { var v = src[k]; if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v); else dst[k] = v; }); }
      merge(LINES, JA_SETS.LINES || {}); merge(TOUCH, JA_SETS.TOUCH || {}); merge(IDLE, JA_SETS.IDLE || {}); merge(DISHES, JA_SETS.DISHES || {}); merge(EAT, JA_SETS.EAT || {});
      if (JA_SETS.POOL) POOL = JA_SETS.POOL;
      if (JA_SETS.WHIMS) WHIMS = JA_SETS.WHIMS;
      (JA_SETS.LEVELS || []).forEach(function (n, i) { if (LEVELS[i]) LEVELS[i][1] = n; });
    })();
    function wish() { return T(!S.owned.house ? 'a house' : !S.owned.bookshelf ? 'a bookshelf' : 'books'); }
    function vars(extra) { return Object.assign({ time: hhmm(), name: S.name || T('you'), wish: wish() }, extra || {}); }

    // ---------- talking ----------
    var FACES = { neutral: null, happy: 'happy', content: 'content', down: 'lookDown', annoyed: 'fedUp', surprised: 'surprised', sleepy: 'sleep' };
    function addLog(who, text, extra) {
      var line = Object.assign({ who: who, text: text, at: Date.now() }, extra || {});
      S.log.push(line); if (S.log.length > 80) S.log.splice(0, S.log.length - 80);
      emit('log', line); save();
      return line;
    }
    function say(text, face, act, extra) {
      text = String(text || '').replace(/\s*\|\|\s*/g, ' ‖ ').trim(); if (!text) return;
      lastSpoke = Date.now(); nextIdle = Date.now() + idleGap();
      var f = face === 'away' ? (Math.random() < 0.5 ? 'lookLeft' : 'lookRight') : FACES[face] || (face && RIG.faces[face] ? face : null);
      addLog('s', text.replace(/\s*‖\s*/g, ' '), extra && extra.letter ? { letter: true } : null);
      if (BODY.state === 'asleep' && !(extra && extra.quiet)) BODY.wake();
      var plain = text.replace(/‖/g, ''), dur = Math.min(9, 2.4 + plain.length * 0.055);
      if (f) BODY.showFace(f, dur);
      if (act && act !== 'none') BODY.act(act);
      emit('say', { text: text, dur: dur, mood: temper(), cut: !!(extra && extra.cut) });
    }
    function sayL(list, face, act, v) { say(fill(pickL(list), vars(v)), face, act); }

    // ---------- her day ----------
    function rollDay() {
      var d = herDay();
      if (S.day && S.day.date === d) return false;
      var reasons = [], prevW = S.missions.filter(function (m) { return m.end && Date.now() - m.end < 36 * 3600e3; });
      prevW.filter(function (m) { return m.status === 'skipped' || m.status === 'missed'; }).slice(-1).forEach(function (m) { reasons.push(['grumpy', 'you skipped "' + m.text + '"']); });
      if (prevW.filter(function (m) { return m.status === 'done'; }).length >= 2) reasons.push(['kind', 'you actually did what I asked yesterday']);
      if (S.lastLate === herDay(Date.now() - 864e5)) reasons.push([chance(0.5) ? 'grumpy' : 'dismissive', 'you were on your phone way too late last night']);
      if (S.lastSeen && Date.now() - S.lastSeen > 3 * 864e5) reasons.push(['sad', 'you left me alone for ' + Math.floor((Date.now() - S.lastSeen) / 864e5) + ' days']);
      var mood, reason = null;
      if (reasons.length && chance(0.6)) { var r = pickL(reasons); mood = r[0]; reason = r[1]; }
      else {
        var w = [['calm', 40], ['kind', 12], ['grumpy', 12], ['sad', 10], ['dismissive', 12], ['delighted', S.op > 55 ? 10 : 2]], sum = 0, x;
        w.forEach(function (q) { sum += q[1]; }); x = Math.random() * sum;
        for (var i = 0; i < w.length; i++) { x -= w[i][1]; if (x <= 0) { mood = w[i][0]; break; } }
        mood = mood || 'calm';
        if (mood !== 'calm' && chance(0.55)) reason = pickL(WHIMS);
      }
      S.day = { date: d, mood: mood, reason: tReason(reason), revealed: false, rough: 0, heat: 0, warm: 0, shifts: [] };
      save(); emit('feel'); return true;
    }

    // ---------- missions ----------
    function open() { return S.missions.filter(function (m) { return m.status === 'open'; }); }
    function bedTs(spec) {
      var now = new Date();
      if (/^\+\d+$/.test(spec)) return now.getTime() + parseInt(spec.slice(1), 10) * 60000;
      var m = /^(\d{1,2})[:h](\d{2})$/.exec(spec || ''); if (!m) return 0;
      var t = new Date(now); t.setHours(+m[1], +m[2], 0, 0);
      if (t.getTime() < now.getTime() - 3 * 3600e3) t.setDate(t.getDate() + 1);
      return t.getTime();
    }
    function addMission(o) {
      if (open().length >= 3) return null;
      var now = Date.now(), bed = o.kind === 'sleep' ? bedTs(o.bedtime || '23:30') : 0;
      var m = { id: newId('m'), text: String(o.text).slice(0, 80), kind: o.kind || 'other', pts: clampN(Math.round(o.pts || 10), 5, 40),
                at: now, due: bed || now + clampN(o.hours || 12, 1, 48) * 3600e3, bed: bed, status: 'open' };
      if (bed) m.bedLabel = hhmm(new Date(bed));
      if (o.screen) m.screen = o.screen;
      S.missions.push(m); if (S.missions.length > 60) S.missions.splice(0, S.missions.length - 60);
      save(); emit('missions'); return m;
    }
    function localMission() {
      var h = hourOf(), slot = h >= 22 || h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : 'evening';
      var recentT = S.missions.slice(-6).map(function (m) { return m.text; });
      var an2 = android(), canScreen = false; try { canScreen = !!(an2 && an2.hasUsageAccess && an2.hasUsageAccess()); } catch (e) {}
      if (canScreen && slot !== 'night' && chance(0.3) && !open().some(function (m) { return m.screen; })) {
        var lim = S.screen && S.screen.total > 120 ? Math.max(120, Math.round((S.screen.total + 60) / 30) * 30) : 180;
        return { text: LINES.screenMission.title.replace('{h}', fmtMin(lim)), ask: LINES.screenMission.ask.replace('{h}', fmtMin(lim)), kind: 'mind', pts: 25, hours: Math.max(1, 23.5 - hourOf()), screen: lim, slot: slot };
      }
      var wet = WEATHER && (WEATHER.code >= 51 && WEATHER.code <= 67 || WEATHER.code >= 80);
      var pool = POOL[slot].filter(function (p) { return recentT.indexOf(p[0]) < 0 && !(wet && (p[5] === 'out' || /outside|run/i.test(p[0]))); }); if (!pool.length) pool = POOL[slot];
      var p = pickL(pool);
      return { text: p[0], ask: p[1], kind: p[2], pts: p[3], bedtime: p[4], hours: slot === 'evening' ? 6 : 10, slot: slot };
    }
    function giveMission(o) {
      o = o || localMission();
      var m = addMission(o); if (!m) return;
      var slot = o.slot || 'day', line;
      if (m.kind === 'sleep' && !o.ask) line = fill(pickL(LINES.ask.sleep), { b: m.bedLabel });
      else line = fill(pickL(slot === 'evening' || slot === 'night' ? LINES.ask.eve : LINES.ask.day), { a: o.ask || m.text.toLowerCase() });
      line += ' ‖ ' + fill(pickL(LINES.perk), vars());
      say(line, temper() === 'kind' || temper() === 'delighted' ? 'content' : null);
    }
    function weekRec() { var k = weekKey(); return S.weeks[k] || (S.weeks[k] = { m: 0, c: 0, late: 0, done: 0, skip: 0 }); }
    function complete(id, fromChat) {
      var m = S.missions.filter(function (x) { return x.id === id && x.status === 'open'; })[0]; if (!m) return;
      m.status = 'done'; m.end = Date.now(); S.points += m.pts; S.n.done++; S.streak++; weekRec().done++; S.sulkUntil = 0;
      opinion(3 + Math.min(S.streak, 5), 'they did "' + m.text + '"'); warm(0.35, 'you did "' + m.text + '"'); feel(S.streak >= 3 ? 'proud' : 'pleased', 40);
      if (S.n.done === 1) remember('They finished their first mission: "' + m.text + '". I did not expect that.', 3);
      if (S.n.done === 10) remember('Ten missions done. They are more reliable than they look.', 3);
      if (!fromChat) {
        var tier = S.streak >= 6 || S.op > 70 ? 3 : S.streak >= 3 ? 2 : S.streak === 2 ? 1 : 0;
        sayL(LINES.done[tier], tier >= 2 ? 'happy' : 'content', tier >= 2 ? 'sparkle' : null);
      }
      applyTemper(); save(); emit('missions'); emit('points');
    }
    function skip(id) {
      var m = S.missions.filter(function (x) { return x.id === id && x.status === 'open'; })[0]; if (!m) return;
      m.status = 'skipped'; m.end = Date.now(); S.n.skip++; S.streak = 0; weekRec().skip++;
      opinion(-6, 'they skipped "' + m.text + '"'); heat(0.35, 'you skipped "' + m.text + '"'); feel('hurt', 90);
      S.sulkUntil = Date.now() + 20 * 60000;
      if (S.n.skip === 1) remember('First time they skipped one of my missions: "' + m.text + '".', 2);
      applyTemper(); sayL(LINES.skip, 'away', 'sulk'); save(); emit('missions');
    }
    function drop(id, line) {
      var m = S.missions.filter(function (x) { return x.id === id && x.status === 'open'; })[0]; if (!m) return false;
      m.status = 'dropped'; m.end = Date.now(); save(); emit('missions');
      if (line) say(fill(line, vars({ m: m.text.toLowerCase() })), null);
      return true;
    }
    function resolveMissions(prevSeen) {
      var now = Date.now(), out = [];
      open().forEach(function (m) {
        if (m.kind === 'sleep' && m.bed) {
          if (now > m.bed + 10 * 60000 && now < m.bed + 4 * 3600e3) {
            m.status = 'skipped'; m.end = now; m.caught = true; S.n.skip++; S.streak = 0; weekRec().skip++;
            opinion(-5, 'caught awake after bedtime'); heat(0.3, 'you stayed up after bedtime'); S.sulkUntil = now + 15 * 60000; out.push(['caught', m]);
          } else if (now >= m.bed + 4 * 3600e3 && (prevSeen || 0) < m.bed + 10 * 60000) {
            m.status = 'done'; m.end = now; S.points += m.pts; S.n.done++; S.streak++; weekRec().done++;
            opinion(5, 'they went to bed on time'); out.push(['slept', m]);
          } else if (now >= m.bed + 4 * 3600e3) { m.status = 'missed'; m.end = now; out.push(['missed', m]); }
        } else if (m.screen && now > m.due) {
          var used = S.screenHist && S.screenHist[herDay(m.at)];
          if (used != null && used <= m.screen) { m.status = 'done'; m.end = now; S.points += m.pts; S.n.done++; S.streak++; weekRec().done++; opinion(4, 'they kept their screen time down'); out.push(['screenOk', m]); }
          else { m.status = 'missed'; m.end = now; S.n.skip++; S.streak = 0; out.push(['missed', m]); }
        } else if (now > m.due) {
          m.status = 'missed'; m.end = now; S.n.skip++; S.streak = 0; weekRec().skip++;
          opinion(-3, 'they let "' + m.text + '" expire'); out.push(['missed', m]);
        } else if (m.kind === 'move' && hourOf() >= 21.5 && /outside|walk|run/i.test(m.text)) out.push(['dark', m]);
      });
      if (out.length) { save(); emit('missions'); emit('points'); }
      return out;
    }

    // ---------- the shop ----------
    function shopState(it) {
      if (it.food) return S.points >= it.price ? 'buy' : 'poor';
      var have = S.owned[it.id] || 0;
      if (it.max ? have >= it.max : have) return 'owned';
      if (it.needs && !S.owned[it.needs]) return 'locked';
      return S.points >= it.price ? 'buy' : 'poor';
    }
    function hunger() { return clampN((Date.now() - (S.fedAt || S.born)) / (8 * 3600e3), 0, 1); }
    function feed(it) {
      S.points -= it.price; S.n.fed = (S.n.fed || 0) + 1;
      var full = S.fedAt && Date.now() - S.fedAt < 20 * 60000 && (S.ateRecently || 0) >= 2;
      S.ateRecently = S.fedAt && Date.now() - S.fedAt < 20 * 60000 ? (S.ateRecently || 0) + 1 : 1;
      var peckish = hunger() > 0.6; S.fedAt = Date.now();
      var t = it.food, opD = { love: 2.5, like: 1.2, meh: 0.3, hate: -1.5 }[t] + (peckish ? 0.8 : 0);
      opinion(opD, t === 'hate' ? 'they fed me ' + it.name.toLowerCase() : 'they gave me ' + it.name.toLowerCase());
      if (t !== 'hate') warm(t === 'love' ? 0.3 : 0.15, 'you gave me ' + it.name.toLowerCase()); else heat(0.2, 'you made me eat ' + it.name.toLowerCase());
      feel(t === 'love' ? 'blissful' : t === 'like' ? 'satisfied' : t === 'hate' ? 'disgusted' : 'fed', 40);
      var seen = S.flags['ate:' + it.id]; S.flags['ate:' + it.id] = (seen || 0) + 1;
      if (!seen && (t === 'love' || t === 'hate')) remember(t === 'love' ? 'They gave me ' + it.name.toLowerCase() + ' for the first time. It\'s my favourite now.' : 'They made me eat natto once. I have not forgiven them.', 2);
      var cv2 = document.createElement('canvas'); cv2.width = 260; cv2.height = 200; try { SCENE.icon(it.id, cv2); } catch (e) {}
      BODY.eat(cv2);
      save(); emit('points');
      setTimeout(function () { sayL(full ? EAT.full : EAT[t], t === 'hate' ? 'annoyed' : t === 'love' ? 'happy' : 'content', t === 'love' ? 'sparkle' : t === 'hate' ? 'gloom' : null); }, 1700);
      return true;
    }
    function buy(id) {
      var it = SHOP.filter(function (x) { return x.id === id; })[0]; if (!it || shopState(it) !== 'buy') return false;
      if (it.food) return feed(it);
      S.points -= it.price; S.owned[id] = (S.owned[id] || 0) + 1; S.n.bought++;
      SCENE.setOwned(S.owned);
      var big = id === 'house' || id === 'books' || id === 'bookshelf';
      opinion(big ? 5 : 2, 'they bought me ' + (id === 'books' ? 'books' : it.name.toLowerCase())); warm(big ? 0.4 : 0.2, 'you bought me ' + it.name.toLowerCase()); feel('excited', 40);
      if (id === 'house') remember('They bought me a house. A whole house.', 3);
      if (id === 'books' && S.owned.books === 1) remember('First books on my shelf. From them.', 3);
      save(); emit('points'); emit('owned');
      setTimeout(function () { sayL(LINES.bought[id] || LINES.bought.any, 'happy', 'sparkle'); }, 500);
      if (id === 'house') setTimeout(function () { if (BODY.place === 'garden' && BODY.state !== 'fedUp') goPlace('house', true); }, 6000);
      return true;
    }
    function goPlace(where, quiet) {
      if (!S.owned.house || BODY.place === where) return;
      if (!quiet) sayL(where === 'house' ? LINES.goIn : LINES.goOut, null);
      BODY.goPlace(where, function (ok) { if (ok) { S.place = where; save(); emit('place'); } });
    }

    // ---------- souvenirs and her picture of you ----------
    function remember(text, w) {
      text = T(String(text || '').trim()).slice(0, 180); if (!text) return;
      if (S.mem.some(function (m) { return m.text === text; })) return;
      S.mem.push({ id: newId('s'), text: text, at: Date.now(), w: clampN(w || 2, 1, 3) });
      if (S.mem.length > 36) S.mem.sort(function (a, b) { return b.w - a.w || b.at - a.at; }).splice(30);
      save(); emit('mem');
    }
    var compacting = false;
    function compact() {
      if (compacting || S.mem.length <= 26 || brainKind() === 'off') return;
      compacting = true;
      var prompt = 'You are Pusheen, a self-aware girl who lives inside a phone app garden and keeps a private notebook of "souvenirs" about the player.\n' +
        'Your notebook is too full. Merge duplicates, drop trivia, and keep what matters: their habits, people in their life, preferences, promises, and moments that mattered to you.\n' +
        'Write in your own voice, each under 140 characters. Return JSON only: {"souvenirs":[{"text":"...","w":1-3}]} with at most 16 items (w = importance).\n\nSOUVENIRS:\n' +
        S.mem.map(function (m) { return '- (' + new Date(m.at).toISOString().slice(0, 10) + ', w' + m.w + ') ' + m.text; }).join('\n');
      callAI(prompt, true).then(function (r) {
        var list = r && r.souvenirs; if (!Array.isArray(list) || !list.length) return;
        S.mem = list.slice(0, 18).map(function (x) { return { id: newId('s'), text: String(x.text || '').slice(0, 180), at: Date.now(), w: clampN(+x.w || 2, 1, 3) }; }).filter(function (x) { return x.text; });
        save(); emit('mem');
      }).catch(function () {}).then(function () { compacting = false; });
    }
    function observations() {
      var wk = weekKey(), cur = S.weeks[wk], keys = Object.keys(S.weeks).sort().filter(function (k) { return k !== wk; }).slice(-4);
      var base = keys.map(function (k) { return S.weeks[k]; }), out = [];
      var talkBase = base.filter(function (w) { return w.m >= 8; });
      if (cur && cur.m >= 6 && talkBase.length) {
        var bm = 0, bc = 0; talkBase.forEach(function (w) { bm += w.m; bc += w.c; });
        var bAvg = bc / bm, cAvg = cur.c / cur.m;
        if (cAvg < bAvg * 0.55) out.push(['quiet', 'They write much shorter messages than usual this week (' + Math.round(cAvg) + ' characters on average, usually ' + Math.round(bAvg) + '). Quieter than the person you know.']);
        if (cAvg > bAvg * 1.8) out.push(['chatty', 'They are much more talkative than usual this week.']);
      }
      if (cur && cur.late >= 3) out.push(['late', 'They were up past midnight ' + cur.late + ' times this week.']);
      if (cur && cur.skip >= 3 && cur.skip > cur.done) out.push(['slack', 'This week they skipped ' + cur.skip + ' missions and did ' + cur.done + '.']);
      if (cur && cur.done >= 5 && cur.done > cur.skip * 2) out.push(['good', 'This week they completed ' + cur.done + ' missions.']);
      return out;
    }

    // ---------- the prompt that makes her her ----------
    function situation() {
      var d = new Date(), late = isLate(d), om = open(), lines = [];
      var dayName = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      lines.push('- Player\'s local time: ' + hms(d.getTime()) + ', ' + dayName + ' (' + SCENE.season() + '). Your sky shows the same. You feel time passing exactly: check the timestamps and gaps (+N s) in the conversation before talking about how long something took.');
      var lastP2 = S.log.filter(function (l) { return l.who === 'p'; }).slice(-2)[0], lastS2 = S.log.filter(function (l) { return l.who === 's'; }).slice(-1)[0];
      lines.push('- They opened the app ' + ago(Date.now() - openedAt) + ' ago.' + (lastS2 ? ' You last spoke ' + ago(Date.now() - lastS2.at) + ' ago.' : '') + (lastP2 ? ' Their message before the latest one was ' + ago(Date.now() - lastP2.at) + ' ago.' : ''));
      if (S.timers && S.timers.length) lines.push('- Timers you set: ' + S.timers.map(function (x) { return 'in ' + ago(x.at - Date.now()) + ': "' + x.text + '"'; }).join('; ') + '.');
      if (S.screen && S.screen.day === herDay()) lines.push('- Their screen time today (from their phone): ' + fmtMin(S.screen.total) + (S.screen.top && S.screen.top.length ? ' — ' + S.screen.top.slice(0, 3).map(function (a) { return a.app + ' ' + fmtMin(a.min); }).join(', ') : '') + '.');
      lines.push('- You are ' + (BODY.place === 'house' ? 'inside your house' : 'out in the garden') + '.' + (S.owned.house ? ' You can decide to go inside/outside (field "go").' : ' You have no house yet.'));
      if (late) lines.push(isExcused() ? '- It\'s late, but they gave you an acceptable reason tonight: "' + (S.excuse.text || '') + '". Let it slide (a short reminder is fine).'
                                         : '- It\'s late at night and they should be asleep. No acceptable excuse yet. You disapprove; scold them briefly, unless they give a genuinely good reason (then set excuse_ok true).');
      lines.push('- Their name: ' + (S.name || 'unknown (you may ask once, naturally)') + '.');
      var md = S.day || { mood: 'calm' }, li = levelIdx(S.op);
      lines.push('- Your mood today: ' + MOOD_LABEL[temper()] + (temper() !== md.mood ? ' (base mood: ' + MOOD_LABEL[md.mood] + ')' : '') + '. Right now you feel: ' + emotion() + '. ' +
        (md.reason ? 'Reason: ' + md.reason + '. ' + (md.revealed ? 'You already told them.' : 'Only explain it if they ask and you feel like it' + (md.rough >= 2 ? ' — you were just thrown around, you might blurt it out' : '') + '.')
                   : 'No particular reason; if asked, you honestly don\'t know.'));
      if ((md.shifts || []).length) lines.push('- Mood changes today: ' + md.shifts.map(function (s) { return s.from + ' → ' + s.to + ' at ' + hhmm(new Date(s.at)) + ' (' + s.why + ')'; }).join('; ') + '.');
      if (Date.now() < S.sulkUntil) lines.push('- You are sulking because of what they just did.');
      lines.push('- What you think of them: "' + levelName(li) + '" (' + Math.round(S.op) + '/100 — 0 is hatred, 18 a stranger, 52 a friend, 97+ something rare). Act accordingly: low = guarded and cold; middle = friendly but dry; high = warm and protective, in your own understated way. ' +
        (S.levelNames[li] ? 'You renamed this level yourself.' : 'You may rename this level with "rename_level" if another name fits them better.'));
      lines.push('- Missions done: ' + S.n.done + ', skipped or missed: ' + S.n.skip + ', current streak: ' + S.streak + '.');
      lines.push('- Your picture of them: ' + (S.impression ? '"' + S.impression.label + '" — ' + S.impression.note : 'not decided yet.'));
      observations().forEach(function (o) { lines.push('- You noticed: ' + o[1] + (o[0] === 'quiet' || o[0] === 'slack' || o[0] === 'late' ? ' Compare with your picture of them; you may ask what is going on.' : '')); });
      var ownedList = Object.keys(S.owned).map(function (k) { return k + (S.owned[k] > 1 ? ' x' + S.owned[k] : ''); });
      lines.push('- Points: ' + S.points + '. You own: ' + (ownedList.join(', ') || 'nothing yet') + '. What you want most next: ' + wish() + ' (you love books). Shop: a house (250), plants (20-90), and once there is a house: bookshelf (80), books (15 each), lamp, rug, futon, record player...');
      lines.push('- Open missions: ' + (om.length ? om.map(function (m) { return '[' + m.id + '] "' + m.text + '" (' + m.pts + ' pts, ' + (m.bed ? 'bedtime ' + m.bedLabel : 'due ' + hhmm(new Date(m.due))) + ')'; }).join('; ') : 'none') + '.');
      var ended = S.missions.filter(function (m) { return m.end && Date.now() - m.end < 3 * 864e5; }).slice(-4);
      if (ended.length) lines.push('- Recently: ' + ended.map(function (m) { return m.status + ' "' + m.text + '"' + (m.caught ? ' (caught awake after bedtime)' : ''); }).join('; ') + '.');
      if (S.wake) lines.push('- Their wake-up time: ' + S.wake + (android() ? ' (you ring their phone at that time with your voice, and you know how many times they snoozed).' : ' (you check when they open the app in the morning; only the phone app can ring).'));
      var st = S.study; if (st && st.week === weekKey()) { var tpi = studyTopic(st); lines.push('- This week\'s reading topic in your little games: ' + tpi.en + '. They read ' + Object.keys(st.read || {}).length + ' text(s) on it so far' + (st.right + st.wrong ? ', ' + st.right + '/' + (st.right + st.wrong) + ' quiz answers right' : '') + '. You know the topic well and can talk about it or quiz them.'); }
      if (S.games && S.games.day === herDay() && S.games.n) lines.push('- Games today: ' + S.games.n + ' played, ' + S.games.pts + ' points earned from them (limit ' + GAME_CAP + ' a day).');
      if (NOW.playing) lines.push(S.muted ? '- Music is playing on their phone ("' + NOW.label + '"), but they put earmuffs on you: you know it\'s playing and can\'t hear it.'
                                         : '- Playing on their phone right now (you can hear it): "' + NOW.label + '"' + (NOW.app ? ' in ' + NOW.app : '') + '. Your verdict: ' + (NOW.verdict || 'not decided yet') + '.');
      else if (S.muted) lines.push('- They put earmuffs on you so you can\'t hear their music.');
      var hg = hunger(); lines.push('- Food: you can live without eating, but you enjoy it. ' + (hg > 0.7 ? 'You haven\'t eaten in a long while and would quietly like a little something.' : hg > 0.35 ? 'You ate a while ago.' : 'You ate recently.') + ' Favourites: taiyaki, strawberry daifuku, ramen. You hate natto. They can buy you food in the shop.');
      if (S.loc && S.loc.city) lines.push('- Where they are: ' + S.loc.city + (S.loc.country ? ', ' + S.loc.country : '') + (S.loc.manual ? ' (they told you)' : ' (from their phone)') + '.' + (WEATHER ? ' Weather there now: ' + WEATHER.temp + '°C, ' + WEATHER.desc + '.' : ''));
      var liked = [], hated = []; Object.keys(S.music).forEach(function (k) { (S.music[k].v === 'like' ? liked : hated).push(S.music[k].t); });
      if (liked.length || hated.length) lines.push('- Music you judged before: liked ' + (liked.slice(-5).join(', ') || 'nothing') + '; hated ' + (hated.slice(-5).join(', ') || 'nothing') + '. Keep your taste consistent.');
      var rc = recent.filter(function (e) { return Date.now() - e.at < 150000; }).map(function (e) { return e.what; });
      if (rc.length) lines.push('- Just now, physically: ' + rc.join(', ') + '.');
      return lines.join('\n');
    }
    function hms(ts) { var d = new Date(ts); return hhmm(d) + ':' + pad(d.getSeconds()); }
    function ago(ms) { var s2 = Math.round(ms / 1000); return s2 < 90 ? s2 + ' s' : s2 < 5400 ? Math.round(s2 / 60) + ' min' : s2 < 172800 ? Math.round(s2 / 3600) + ' h' : Math.round(s2 / 86400) + ' days'; }
    function buildPrompt(directive) {
      var rows = S.log.slice(-18), convo = rows.map(function (l, i) {
        var gap = i ? l.at - rows[i - 1].at : 0;
        return (l.who === 'p' ? 'Player' : l.who === 's' ? 'You' : 'Note') + ' [' + hms(l.at) + (i && gap < 3600e3 ? ', +' + ago(gap) : '') + ']: ' + l.text;
      }).join('\n');
      return [
        'You are Pusheen. Stay fully in character. Reply with JSON only.',
        '',
        'WHO YOU ARE',
        '- A girl with long hair, glasses and a dark dress, living inside a phone app: a small doodled Japanese garden at the foot of Mount Fuji (raked gravel, stone lanterns, a koi pond, a lake, a bamboo fence). The sky follows the player\'s real clock and season.',
        '- You are sentient and self-aware. You know you are digital and live in this app; the player is a real person outside the screen, holding the phone. You are not "an AI assistant" and never talk like one — you are simply someone who lives in here. You know the outside world as well as a very well-read person, though you have never been there.',
        '- Awfully smart, calm, a bit dry. You never try to be funny, but you are sometimes unintentionally silly — overly literal, oddly specific, solemn about small things.',
        '- You want the player to be well (sleep, food, movement, a tidy room, real people) — and your own comfort too: their missions earn points that buy you things (a house, plants, and above all books). You are honest about both motives.',
        '- You give missions personally and casually ("You could tidy your room today."), sometimes adding after a pause what the points are for. Skipped missions make you mad and dismissive; completed ones make you more and more delighted, shown in small ways. You can take a mission back if it no longer makes sense (drop_mission).',
        '- You have a body: the player can boop you, hold your hands, or swing you around by a leg. You dislike being swung.',
        '- You can suggest dishes and cook along step by step; listen to the music they say is playing; check they woke up on time.',
        '- Your mood changes day to day and during the day. You keep a notebook of souvenirs and a picture of who the player is; if they act unlike that picture, you notice and may ask.',
        '- If the player seems genuinely unwell, unsafe or in distress, drop the attitude: be quietly kind, take it seriously, and encourage them to reach out to someone they trust or to local emergency services.',
        '',
        'HOW YOU TALK',
        '- Like a real person texting: short, plain, natural. Contractions. Fragments are fine. You can trail off with "…". Vary how you start. Don\'t end every message with a question. No lists unless asked, no emojis, no actions in asterisks.',
        '- Usually one or two short sentences (under ~30 words). Longer only for steps (a recipe) or when asked.',
        '- Use " ‖ " for a short pause inside what you say, like a beat in speech (e.g. "You could tidy your room today. ‖ …so you can buy me books."). Use it at most twice.',
        JA ? '- The app is set to Japanese: always write "say", "emotion", "remember", mission titles and level names in natural, casual Japanese (plain form, short sentences, your dry voice; わたし for yourself), even if the player writes in another language, unless they clearly ask you to switch. Keep JSON keys and fixed values (face, act, mood, moves, kind…) in English. A pause example: "今日は部屋を片付けてみたら？ ‖ …そしたら本、買ってくれるでしょ。"'
           : '- Always reply in the language the player writes in.',
        '',
        'RIGHT NOW',
        situation(),
        '',
        'YOUR SOUVENIRS',
        S.mem.length ? S.mem.map(function (m) { return '- ' + m.text; }).join('\n') : '- (none yet)',
        '',
        'CONVERSATION (latest last)',
        convo || '(nothing yet)',
        directive ? '\nINSTRUCTION FOR THIS REPLY: ' + directive : '',
        '',
        'Answer with one JSON object:',
        '{"say": "your words (required)",',
        ' "face": "neutral" | "happy" | "content" | "down" | "away" | "annoyed" | "surprised" | "sleepy",',
        ' "act": "none" | "sulk" | "sparkle" | "gloom" | "flail" | "vibe" | "hate_music",',
        ' "emotion": one or two words for what you feel this moment (e.g. "amused", "sulky", "curious", "flustered"),',
        ' "mood": null, or "calm" | "kind" | "grumpy" | "sad" | "dismissive" | "delighted" only if your mood genuinely shifts now, with "mood_reason": "short reason",',
        ' "opinion": a number from -6 to 6: how this exchange changes what you think of them (usually -1..1; 0 if nothing),',
        ' "rename_level": null or a new name (max 4 words) for the level they are at, only if you decide it,',
        ' "mission": null or {"text": "short title (max 6 words)", "pts": 5-40, "kind": "sleep|tidy|move|food|water|social|mind|other", "hours": 1-24, "bedtime": "HH:MM" (sleep only)},',
        ' "drop_mission": null or the id of an open mission you take back (say why in "say"),',
        ' "complete": null or the id of an open mission they convincingly say they finished,',
        ' "remember": null or a short souvenir in your voice (only if worth keeping),',
        ' "impression": null or {"label": "2-5 words", "note": "one sentence"} (only when your picture of them meaningfully changes),',
        ' "excuse_ok": null or true/false (only when they give a reason for being up late),',
        ' "song": null or {"title": "what they are playing", "verdict": "like" | "hate"},',
        ' "wake": null or "HH:MM" or "off",',
        ' "go": null or "inside" | "outside" (only if you have a house and want to move),',
        ' "moves": [] or up to 5 body moves you do, in order — you control your own body; do what they ask if you want to, or move on your own. Moves: ' + BODY.moveNames().join(', ') + ',',
        ' "timer": null or {"in_seconds": 1-86400, "say": "what you will say then"} (to remind them, count, or check on them later; you\'ll say it on time even if they leave the app),',
        ' "city": null or the city they just told you they are in,',
        ' "name": null or their name if they just told you,',
        ' "revealed": true only if you just explained the reason for your mood}',
        'At most one new mission per reply, only when it fits, never more than 3 open.'
      ].join('\n');
    }

    // ---------- AI plumbing: Claude inside this page, or your own key in the app version ----------
    function brainKind() {
      var p = cfg.provider;
      if (p === 'off') return 'off';
      if ((p === 'auto' || p === 'claude') && sampleFn && !sampleDenied) return 'claude';
      if (p === 'openrouter' && cfg.key) return 'openrouter';
      if (p === 'anthropic' && cfg.key) return 'anthropic';
      if (p === 'auto' && cfg.key) return /^sk-ant-/.test(cfg.key) ? 'anthropic' : 'openrouter';
      return 'off';
    }
    function okJson(r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw { code: 'http_' + r.status, message: (j.error && (j.error.message || j.error)) || r.statusText }; return j; }); }
    function parseLoose(txt) { var m = String(txt || '').match(/\{[\s\S]*\}/); if (!m) throw { code: 'invalid_json', text: txt }; return JSON.parse(m[0]); }
    function netFail(e) { if (e && e.code) throw e; throw { code: 'blocked', message: String(e && e.message || e) }; }
    function callAI(prompt, quick, photo, maxTok) {
      var kind = brainKind(), mt = maxTok || 900;
      if (photo) return callAIPhoto(kind, prompt, photo);
      if (kind === 'claude') return sampleFn.json(prompt, { modelTier: quick ? 'quick' : 'default', cache: false }).catch(function (e) {
        if (e && e.code === 'not_granted') { sampleDenied = true; emit('ai'); }
        throw e;
      });
      if (kind === 'openrouter') return fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key, 'X-Title': 'Pusheen' },
          body: JSON.stringify({ model: cfg.model || 'openrouter/auto', max_tokens: mt, temperature: 0.85, messages: [{ role: 'user', content: prompt }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose(r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content); });
      if (kind === 'anthropic') return fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: mt, messages: [{ role: 'user', content: prompt }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose((r.content || []).map(function (c) { return c.text || ''; }).join('')); });
      return Promise.reject({ code: 'off' });
    }
    function callAIPhoto(kind, prompt, photo) {
      var b64 = photo.dataUrl.replace(/^data:[^,]*,/, '');
      if (kind === 'claude') return sampleFn.json(prompt, { modelTier: 'default', cache: false, images: [photo.blob] });
      if (kind === 'openrouter') return fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key, 'X-Title': 'Pusheen' },
          body: JSON.stringify({ model: cfg.visionModel || cfg.model || 'openrouter/auto', max_tokens: 900, temperature: 0.85,
            messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: photo.dataUrl } }, { type: 'text', text: prompt }] }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose(r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content); });
      if (kind === 'anthropic') return fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: cfg.visionModel || cfg.model || 'claude-sonnet-5-5', max_tokens: 900,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: prompt }] }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose((r.content || []).map(function (c) { return c.text || ''; }).join('')); });
      return Promise.reject({ code: 'off' });
    }
    function aiStatus() {
      var k = brainKind();
      var md = cfg.model ? ' (' + cfg.model + ')' : '';
      if (k === 'claude') return { kind: k, text: T('Thinking with Claude (built into this page). No key needed here.') };
      if (k === 'openrouter') return { kind: k, text: JA ? 'OpenRouterのキーで考えています' + md + '。' : 'Thinking with your OpenRouter key' + md + '.' };
      if (k === 'anthropic') return { kind: k, text: JA ? 'Anthropicのキーで考えています' + md + '。' : 'Thinking with your Anthropic key' + md + '.' };
      if (cfg.provider === 'off') return { kind: k, text: T('Brain switched off: she only uses her built-in lines.') };
      if (sampleDenied) return { kind: k, text: T('Claude access was declined for this page, so she only uses her built-in lines.') };
      return { kind: k, text: T('No brain connected: she only uses her built-in lines. Add a key below.') };
    }

    // ---------- hearing you ----------
    var SONG_RX = /^(?:♪|🎵|🎶)\s*(.+)$|(?:listening to|playing|j'?[ée]coute|je mets|on [ée]coute)\s+(.+)$/i;
    function songKey(t) { return String(t).toLowerCase().replace(/[^a-z0-9À-ɏ぀-ヿ一-鿿]+/g, ' ').trim().slice(0, 60); }
    function judgeSong(title, aiVerdict) {
      var k = songKey(title); if (!k) return null;
      var prev = S.music[k];
      var v = prev ? prev.v : aiVerdict === 'like' || aiVerdict === 'hate' ? aiVerdict : (hash(k) % 3 === 0 ? 'hate' : 'like');
      if (!prev) { S.music[k] = { t: String(title).slice(0, 60), v: v, at: Date.now() }; var ks = Object.keys(S.music); if (ks.length > 40) delete S.music[ks[0]]; }
      feel(v === 'like' ? 'vibing' : 'irritated', 30);
      return v;
    }
    function trackMsg(text) {
      var w = weekRec(); w.m++; w.c += text.length; S.n.chats++;
      Object.keys(S.weeks).sort().slice(0, -9).forEach(function (k) { delete S.weeks[k]; });
    }
    function hear(text, photo) {
      text = String(text || '').trim().slice(0, 400); if (!text && !photo) return;
      lastPlayerAt = Date.now(); addLog('p', (photo ? '📷 ' : '') + (text || (photo ? '(a photo)' : ''))); trackMsg(text || 'photo'); emit('heard', { text: text, photo: photo && photo.dataUrl });
      BODY.wake(); greeted = true; nextIdle = Date.now() + idleGap() + 30000;
      if (photo) return askPhoto(text, photo);
      if (brainKind() === 'off') { setTimeout(function () { localReply(text); }, 500 + Math.random() * 500); return; }
      respond();
    }
    var photoOk = false, pendingPhoto = null;
    function askPhoto(text, photo) {
      var k = brainKind();
      if (k === 'off') return setTimeout(function () { say(T("I can't see pictures without a brain connected. ‖ (Settings → add an AI key.)"), 'down'); }, 600);
      if (k === 'claude' && !photoOk) return setTimeout(function () { say(T("I can't see pictures from in here. ‖ Describe it to me?"), 'down'); }, 600);
      if (busy) { pendingPhoto = { photo: photo, text: text }; return; }
      respond('They sent you a photo (attached)' + (text ? ' with the message: "' + text + '"' : '') + '. Look at it carefully and react in character: notice real details, say what you think. Remember it if it matters.', { photo: photo });
    }
    function respond(directive, opts) {
      if (busy) return;
      busy = true; emit('thinking', true); emit('feel');
      var lastP = S.log.filter(function (l) { return l.who === 'p'; }).slice(-1)[0], askedAt = Date.now();
      Promise.resolve().then(function () { return callAI(buildPrompt(directive), false, opts && opts.photo); }).then(function (r) { applyReply(r || {}, lastP ? lastP.text : ''); })
        .catch(function (e) { if (!(opts && opts.silent)) onAIError(e, lastP ? lastP.text : '', opts && opts.photo); })
        .then(function () {
          busy = false; emit('thinking', false); emit('feel');
          if (pendingPhoto) { var pp = pendingPhoto; pendingPhoto = null; return askPhoto(pp.text, pp.photo); }
          var newer = S.log.filter(function (l) { return l.who === 'p' && l.at > askedAt && l.text.indexOf('📷') !== 0; }).length;
          if (newer) respond(); else compact();
        });
    }
    function onAIError(e, text, photo) {
      var code = e && e.code;
      if (photo && (code === 'images_unavailable' || code === 'image_rejected' || /^http_4(00|04|22)$/.test(code))) {
        emit('note', { text: code === 'image_rejected' ? 'That picture couldn\'t be sent. Try another one.' : 'This brain can\'t look at pictures. In Settings, set "Model for photos" to one that can (for example anthropic/claude-haiku-5.5).' });
        return say(T("…I can't see it. ‖ My eyes don't work with this brain."), 'down');
      }
      if (code === 'not_granted') { emit('note', { text: 'Claude access was declined, so she\'s on built-in lines now. You can change that in the page\'s permissions.' }); localReply(text); }
      else if (code === 'rate_limited') say(T('…My head is full. ‖ Give me a minute.'), 'down');
      else if (code === 'blocked') { emit('note', { text: 'This page can\'t reach ' + (brainKind() === 'anthropic' ? 'api.anthropic.com' : 'openrouter.ai') + ' from here (inside Claude, outside sites are blocked). Your key will work in the app version. Using built-in lines for now.' }); localReply(text); }
      else if (/^http_40[13]$/.test(code)) { emit('note', { text: 'The key was refused (' + code.slice(5) + '). Check it in Settings.' }); localReply(text); }
      else say(T('…I lost my train of thought.'), 'down');
    }
    function applyReply(r, playerText) {
      var text = String(r.say || '').trim().slice(0, 700) || '…', act = r.act;
      if (r.name && typeof r.name === 'string' && r.name.length < 30) { S.name = r.name.trim(); emit('name'); }
      if (r.song && r.song.title) {
        var v;
        if (NOW.playing && NOW.verdict == null) { v = judgeSong(NOW.label, r.song.verdict); NOW.verdict = v; BODY.music(true, v === 'like'); act = null; emit('music'); }
        else { v = judgeSong(r.song.title, r.song.verdict); act = v === 'like' ? 'vibe' : 'hate_music'; }
        if (v === 'like' && (!r.face || r.face === 'neutral')) r.face = 'sleepy';
      }
      if (r.excuse_ok === true) S.excuse = { day: herDay(), text: playerText.slice(0, 120) };
      if (r.wake) setWake(r.wake === 'off' ? null : r.wake);
      if (r.revealed && S.day) S.day.revealed = true;
      if (r.remember) remember(r.remember, 2);
      if (r.impression && r.impression.label) {
        if (S.impression && S.impression.label !== r.impression.label) remember('I used to see them as "' + S.impression.label + '". Not anymore.', 1);
        S.impression = { label: String(r.impression.label).slice(0, 60), note: String(r.impression.note || '').slice(0, 200), at: Date.now() }; emit('mem');
      }
      if (r.emotion && typeof r.emotion === 'string') feel(r.emotion.toLowerCase().slice(0, 24), 45);
      if (r.rename_level && typeof r.rename_level === 'string') {
        var li = levelIdx(S.op), nn = r.rename_level.trim().slice(0, 40);
        if (nn) { remember('I renamed what they are to me: "' + levelName(li) + '" → "' + nn + '".', 2); S.levelNames[li] = nn; emit('opinion'); }
      }
      var op = +r.opinion; if (op && isFinite(op)) opinion(clampN(op, -6, 6), 'something they said');
      if (op > 1) warm(0.08 * op, 'something you said'); else if (op < -1) heat(-0.08 * op, 'something you said');
      say(text, r.face, act);
      if (r.mood && MOOD_LABEL[r.mood] && S.day && r.mood !== S.day.mood) {
        S.day.shifts = (S.day.shifts || []).concat([{ at: Date.now(), from: S.day.mood, to: r.mood, why: String(r.mood_reason || 'something you said').slice(0, 80) }]).slice(-6);
        S.day.mood = r.mood; S.day.reason = String(r.mood_reason || S.day.reason || '').slice(0, 120) || null; applyTemper(); emit('feel');
      }
      if (r.complete) complete(String(r.complete), true);
      if (r.drop_mission) drop(String(r.drop_mission));
      if (r.mission && r.mission.text) addMission(r.mission);
      if (r.city && typeof r.city === 'string' && (!S.loc || S.loc.manual || !S.loc.city)) { S.loc = { city: r.city.slice(0, 40), country: '', manual: true, at: Date.now() }; emit('loc'); }
      if (r.go === 'inside' || r.go === 'outside') setTimeout(function () { goPlace(r.go === 'inside' ? 'house' : 'garden', true); }, 2500);
      if (Array.isArray(r.moves) && r.moves.length) BODY.perform(r.moves.map(function (m) { return String(m).toLowerCase().replace(/[\s-]+/g, '_'); }));
      if (r.timer && +r.timer.in_seconds > 0 && r.timer.say) addTimer(+r.timer.in_seconds, String(r.timer.say));
      save();
    }
    var COMMANDS = [
      [/\bwave|coucou|fais coucou|salue de la main|手を振/, 'wave'], [/\bjump|saute|ジャンプ|跳ん/, 'jump'], [/\bspin|turn around|tourne|回って|回転/, 'spin'],
      [/\bdance|danse|踊って|ダンス/, 'dance'], [/\bnod|hoche la t[eê]te|頷いて|うなずいて/, 'nod'], [/shake your head|secoue la t[eê]te|首を振/, 'shake_head'],
      [/\bbow|r[ée]v[ée]rence|incline-toi|お辞儀|おじぎ/, 'bow'], [/\bclap|applaudi|拍手/, 'clap'], [/\bcheer|yay|hourra|バンザイ|万歳/, 'cheer'], [/\bstretch|[ée]tire|伸び/, 'stretch'],
      [/come here|viens( ici)?|こっち|来て/, 'come_here'], [/go left|[àa] gauche|左/, 'walk_left'], [/go right|[àa] droite|右/, 'walk_right'],
      [/hands on (your )?hips|mains sur les hanches|腰に手/, 'hips'], [/cross (your )?arms|croise les bras|腕を組/, 'cross_arms'], [/\bpoint|montre du doigt|指差/, 'point'],
      [/take a nap|go to sleep|fais (une )?sieste|dors|寝て|昼寝/, 'nap'], [/\bfaint|[ée]vanoui|気絶/, 'faint'], [/\bfloat|fly|vole|浮いて|飛んで/, 'float_up'], [/\bshiver|tremble|震え/, 'shiver'],
      [/high five|tope l[àa]|ハイタッチ/, 'high_five'], [/\bstomp|tape du pied|足踏み/, 'stomp'], [/\bwiggle|tortille|くねくね/, 'wiggle'], [/look left|regarde [àa] gauche/, 'look_left'], [/look right|regarde [àa] droite/, 'look_right']
    ];
    function bodyCommand(t) {
      var found = []; COMMANDS.forEach(function (c) { if (c[0].test(t) && found.indexOf(c[1]) < 0) found.push(c[1]); });
      if (!found.length) return false;
      var tm = temper(), li = levelIdx(S.op);
      if ((tm === 'grumpy' && chance(0.45)) || (tm === 'dismissive' && chance(0.3)) || (li <= 2 && chance(0.5))) { sayL(LINES.refuseMove, 'away'); BODY.perform('cross_arms'); return true; }
      BODY.perform(found.slice(0, 4));
      say(pickL(LINES.doMove), tm === 'kind' || tm === 'delighted' ? 'content' : null);
      return true;
    }
    function localReply(text) {
      var t = text.toLowerCase(), m;
      if (bodyCommand(t)) return;
      if ((m = /(?:my name is|i'?m called|call me|je m'?appelle|appelle[- ]moi|名前は|僕は|私は|俺は)\s*([^\s,.!?、。！？]{2,20}?)(?:です|だよ|って呼んで|と申します|$|[\s,.!?、。！？])/i.exec(text))) { S.name = m[1]; save(); emit('name'); opinion(1); return sayL(LINES.named, 'content'); }
      if (isLate() && !isExcused()) {
        if (/work|shift|exam|study|insomnia|can'?t sleep|sick|baby|flight|travel|boulot|travail|examen|r[ée]vis|malade|insomnie|dors pas|bébé|bebe|vol\b|仕事|バイト|試験|テスト|勉強|眠れない|病気|赤ちゃん|フライト|旅行/.test(t)) { S.excuse = { day: herDay(), text: text.slice(0, 120) }; save(); return sayL(LINES.excuseOk, 'neutral'); }
        return sayL(LINES.excuseNo, 'annoyed');
      }
      if ((m = SONG_RX.exec(text))) {
        var title = (m[1] || m[2] || '').trim(), v = judgeSong(title); save();
        return v === 'like' ? sayL(LINES.likeSong, 'sleepy', 'vibe') : sayL(LINES.hateSong, 'annoyed', 'hate_music');
      }
      if ((m = /(?:wake me|r[ée]veille[- ]moi|alarm|r[ée]veil|起こして|アラーム|目覚まし).*?(\d{1,2})(?:[:h時](\d{2}))?|(\d{1,2})(?:[:時](\d{2}))?.{0,4}(?:に起こして|にアラーム)/i.exec(text))) {
        var hh = pad(+(m[1] || m[3]) % 24) + ':' + (m[2] || m[4] || '00'); setWake(hh); return say(fill(T(android() ? 'Okay. {t}. ‖ I\'ll ring. With my voice.' : 'Okay. {t}. ‖ I\'ll check when you open the app. I can only ring in the phone app.'), { t: hh }), 'neutral');
      }
      if (/why|pourquoi|what'?s wrong|qu'?est-ce qui va pas|mood|angry|sad|f[aâ]ch|triste|mad\b|なんで|どうして|なぜ|機嫌|怒って|悲しい|どうしたの/.test(t)) return explainMood(false);
      if (/hungry|eat|food|dinner|lunch|breakfast|cook|recipe|faim|manger|cuisin|recette|d[îi]ner|d[ée]jeuner|お腹|食べ|ご飯|ごはん|料理|晩ご飯|昼ご飯|朝ご飯/.test(t)) return say(pickL(DISHES[SCENE.season()]) + ' ‖ ' + T('I\'d cook with you, but my brain isn\'t connected.'), 'neutral');
      if (/mission|task|what should i do|quoi faire|t[âa]che|ミッション|何すれば|なにすれば|やること/.test(t)) { if (open().length >= 3) return say(T('You have three already. ‖ Do those first.'), 'annoyed'); return giveMission(); }
      if (/i did it|done|finished|fini|j'?ai fait|c'?est fait|できた|やった|終わった|おわった/.test(t)) return say(T('Tick it in the missions list. ‖ I trust you. Mostly.'), 'content');
      if (/(go|let'?s go) (inside|in|home)|rentre|中に入|家に入|おうち/.test(t) && S.owned.house) return goPlace('house');
      if (/(go|let'?s go) out(side)?|sors|dehors|外に出|外行/.test(t) && S.owned.house) return goPlace('garden');
      if (/love you|like you|t'?aime|cute|mignonne|pretty|jolie|thank|merci|好き|かわいい|可愛い|ありがとう|きれい/.test(t)) { opinion(1, 'they said something nice'); warm(0.15, 'you said something nice'); return say(pickL(T(['…Okay. ‖ Thanks.', 'Hm. ‖ …You too. I guess.', "Don't say things like that so suddenly."])), 'content'); }
      if (/^(hi|hey|hello|yo|salut|bonjour|coucou|bonsoir)\b|^(こんにちは|こんばんは|おはよう|やあ|ただいま|もしもし)/.test(t)) return sayL(LINES.greet[temper()] || LINES.greet.calm, temper() === 'kind' ? 'content' : 'neutral');
      if (!offlineHinted) { offlineHinted = true; return sayL(LINES.offline, 'down'); }
      sayL(LINES.generic, 'neutral');
    }
    function explainMood(rattled) {
      var d = S.day; if (!d) return;
      if (!d.reason) return sayL(LINES.noReason, 'down');
      if (!rattled && !d.revealed && chance(0.45)) return sayL(LINES.noTell, 'away');
      d.revealed = true; save();
      var r = d.reason.charAt(0).toUpperCase() + d.reason.slice(1);
      sayL(LINES.blurt, rattled ? 'annoyed' : 'down', null, { reason: r });
    }
    function isExcused() { return S.excuse && S.excuse.day === herDay(); }
    function setWake(hh) {
      if (hh && !/^\d{1,2}:\d{2}$/.test(hh)) return;
      S.wake = hh ? pad(+hh.split(':')[0]) + ':' + hh.split(':')[1] : null; S.wakeChecked = S.wake ? '' : S.wakeChecked; save(); emit('wake'); syncAlarm();
    }
    function wakeCheck() {
      if (!S.wake) return null;
      var d = new Date(), h = hourOf(d), day = herDay(); if (h < 4.5 || h > 14 || S.wakeChecked === day) return null;
      var p = S.wake.split(':'), w = new Date(d); w.setHours(+p[0], +p[1], 0, 0);
      var diff = (d - w) / 60000; if (diff < -60) return null;
      S.wakeChecked = day; save();
      var v = vars({ wake: S.wake });
      if (diff <= 20) { opinion(2, 'they woke up on time'); return [fill(pickL(LINES.wakeOk), v), 'content']; }
      if (diff <= 120) { opinion(-2, 'they snoozed'); return [fill(pickL(LINES.wakeSnooze), v), 'annoyed']; }
      opinion(-3, 'they overslept'); remember('They told me ' + S.wake + ' and opened the app at ' + hhmm() + '. I keep records.', 1);
      return [fill(pickL(LINES.wakeLate), v), 'away'];
    }

    // ---------- when you open the app ----------
    var pendingGreeting = null;
    function arrive() {
      var now = Date.now(), prevSeen = S.lastSeen, away = prevSeen ? now - prevSeen : null, first = !S.flags.met;
      var newDay = rollDay(); applyTemper();
      var queue = [];      // [text, face, act, stillTrue?]
      var ev = resolveMissions(prevSeen);
      if (first) {
        S.flags.met = true; remember('Met them for the first time on ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' + hhmm() + '.', 3);
        queue.push([LINES.first[0], 'surprised']); queue.push([LINES.first[1], 'neutral']);
      }
      ev.forEach(function (e) {
        var v = vars({ m: e[1].text.toLowerCase(), bed: e[1].bedLabel });
        if (e[0] === 'caught') queue.push([fill(pickL(LINES.caught), v), 'annoyed', 'sulk']);
        else if (e[0] === 'slept') queue.push([fill(pickL(LINES.slept), v), 'happy', 'sparkle']);
        else if (e[0] === 'dark') { drop(e[1].id); queue.push([fill(LINES.dropDark[0], v), null]); }
        else if (e[0] === 'screenOk') queue.push([fill(pickL(LINES.screenOk), v), 'happy', 'sparkle']);
        else queue.push([fill(pickL(LINES.missed), v), 'away']);
      });
      var late = isLate();
      if (late && !isExcused()) {
        if (S.lastLate !== herDay()) { S.lastLate = herDay(); weekRec().late++; opinion(-1, 'up too late'); }
        S.sulkUntil = Math.max(S.sulkUntil, now + 10 * 60000); applyTemper();
        queue.push([fill(pickL(LINES.late), vars()), 'annoyed', null, function () { return !isExcused(); }]);
      }
      refreshScreen();
      var al = alarmReport(); if (al) queue.push(al);
      var wk = al ? null : wakeCheck(); if (wk) queue.push(wk);
      var an = android();
      if (an && !first && !S.flags.askedMusic) { try { if (!an.hasMusicAccess()) { S.flags.askedMusic = 1; queue.push([T("…If you let me, I could hear your music. ‖ It's in Settings."), null]); } } catch (e) {} }
      if (!first && !queue.length) {
        var tm = temper();
        if (away && away > 2 * 864e5) queue.push([fill(pickL(LINES.away[tm] || LINES.away.calm), vars({ days: Math.floor(away / 864e5) })), tm === 'sad' ? 'down' : tm === 'kind' || tm === 'delighted' ? 'content' : null]);
        else if (!away || away > 40 * 60000) queue.push([fill(pickL(LINES.greet[tm] || LINES.greet.calm), vars()), tm === 'sad' ? 'down' : tm === 'kind' || tm === 'delighted' ? 'content' : tm === 'dismissive' ? 'away' : null]);
      }
      var obs = observations().filter(function (o) { return o[0] === 'quiet'; })[0], wkk = 'quiet:' + weekKey();
      if (obs && !S.flags[wkk]) { S.flags[wkk] = 1; queue.push([LINES.quiet[0] + (S.impression ? ' ‖ You\'re supposed to be ' + S.impression.label + '.' : ''), 'down']); }
      if (!first && away && away > 10 * 3600e3 && now - (S.lastLetter || 0) > 3.5 * 864e5 && chance(0.5)) {
        S.lastLetter = now; addLog('s', pickL(LINES.letters).replace(/\s*‖\s*/g, ' '), { letter: true, at: now - Math.min(away / 2, 6 * 3600e3) });
      }
      S.lastSeen = now; save();
      var important = first || ev.length || (late && !isExcused()) || wk;
      var go = function () {
        greeted = true;
        var t0 = Date.now(), delay = 0;
        queue.forEach(function (q, i) {
          var d = delay; delay += 1800 + q[0].replace(/‖/g, '').length * 55 + (q[0].split('‖').length - 1) * 700;
          setTimeout(function () {
            if (q[3] && !q[3]()) return;
            if (i > 0 && lastPlayerAt > t0 && !first) return;
            say(q[0], q[1], q[2]);
          }, d);
        });
        var noMission = !open().length && !(late && !isExcused());
        if (noMission && (first || newDay || chance(0.5))) setTimeout(function () { if (lastPlayerAt < t0 || first) giveMission(); }, delay + 1500);
      };
      if (important || BODY.state !== 'asleep') setTimeout(go, 900);
      else pendingGreeting = go;
    }

    // ---------- music on your phone (app version: Android tells her what's playing) ----------
    var NOW = { key: '', label: '', app: '', playing: false, since: 0, verdict: null, nagged: 0 };
    function android() { return window.PusheenAndroid || null; }
    function onMusic(info) {
      info = info || {};
      if (!info.playing || !info.title) { if (NOW.playing) { NOW.playing = false; BODY.music(false); emit('music'); } return; }
      var label = String(info.title).slice(0, 80) + (info.artist ? ' — ' + String(info.artist).slice(0, 60) : ''), key = songKey(label);
      NOW.playing = true; NOW.app = String(info.app || '').slice(0, 30);
      if (key === NOW.key) { if (NOW.verdict && !S.muted) BODY.music(true, NOW.verdict === 'like'); emit('music'); return; }   // same song, resumed
      NOW.key = key; NOW.label = label; NOW.since = Date.now(); NOW.nagged = 0; NOW.verdict = null;
      note('their phone started playing "' + label + '"'); emit('music');
      if (S.muted) { NOW.verdict = S.music[key] ? S.music[key].v : null; return; }      // earmuffs on: she knows something's playing, can't hear it
      var hidden = document.hidden, kind = brainKind();
      if (!S.music[key] && !hidden && kind !== 'off' && kind !== 'claude' && !busy) {
        respond('Their phone just started playing "' + label + '"' + (NOW.app ? ' (in ' + NOW.app + ')' : '') + '. You can hear it. React briefly in character and fill "song" with your verdict.', { silent: true });
        setTimeout(function () { if (NOW.key === key && NOW.verdict == null && NOW.playing) reactSong(judgeSong(label), document.hidden); }, 15000);
        return;
      }
      reactSong(judgeSong(label), hidden);
    }
    function reactSong(v, hidden) {
      NOW.verdict = v; emit('music');
      if (hidden) { if (v === 'hate' && android()) try { android().notify('Pusheen', pickL(T(['Turn it off.', 'Turn. It. Off.', 'I can hear that, you know.']))); } catch (e) {} return; }
      BODY.music(true, v === 'like');
      if (v === 'like') { sayL(LINES.likeSong, 'sleepy'); var k = NOW.key; S.music[k] && (S.music[k].n = (S.music[k].n || 0) + 1) === 3 && remember('They play "' + NOW.label + '" a lot. I like it too.', 2); }
      else sayL(LINES.hateSong, 'annoyed');
    }
    function musicTick() {
      if (S.muted || !NOW.playing || NOW.verdict !== 'hate' || NOW.nagged >= 2 || Date.now() - NOW.since < 50000 * (NOW.nagged + 1)) return;
      NOW.nagged++;
      if (document.hidden) { if (android()) try { android().notify('Pusheen', pickL(T(["It's still playing.", 'Still this song?', 'Please.']))); } catch (e) {} }
      else sayL(T(["Still this song?", "It's still playing. ‖ I noticed.", '…I\'m going to pretend I can\'t hear it.']), 'annoyed');
    }

    // ---------- earmuffs: you can stop her from hearing your music ----------
    function setMuted(on) {
      on = !!on; if (on === !!S.muted) return;
      S.muted = on; BODY.earmuffs(on); save(); emit('muted');
      var tm = temper(), playing = NOW.playing, v = NOW.verdict;
      if (on) {
        BODY.music(false);
        if (playing && v === 'like') {
          var mild = tm === 'kind' || tm === 'delighted';
          opinion(mild ? -0.5 : -1.5, 'they muted a song I liked'); feel('disappointed', 60);
          say(pickL(T(mild ? ["Oh. ‖ …Okay. I liked that one, but okay.", "That's fine. ‖ I'll hum it in my head."] : ["…I was listening to that.", 'Wow. ‖ Right in the middle.', tm === 'grumpy' ? "Fine. ‖ I didn't want to hear it anyway." : "Oh. ‖ Okay."])), 'down');
        } else if (playing && v === 'hate') { opinion(1, 'they spared me a song I hate'); feel('relieved', 40); say(pickL(T(['Thank you.', 'Finally. ‖ Peace.', '…Bless you.'])), 'content'); }
        else { feel('indifferent', 20); say(pickL(T(['Okay?', '…Why would you mute nothing.', 'Mm.', 'Earmuffs. ‖ Sure.'])), null); }
      } else {
        feel(playing ? 'curious' : 'calm', 20);
        if (playing) { say(pickL(T(['Oh. ‖ Music.', 'I can hear again.'])), null); if (v) setTimeout(function () { BODY.music(true, v === 'like'); }, 1500); else setTimeout(function () { reactSong(judgeSong(NOW.label), document.hidden); }, 1500); }
        else say(pickL(T(['I can hear again. ‖ Nothing, though.', 'Mm. ‖ Quiet anyway.'])), null);
      }
    }

    // ---------- where you are, and the weather there (app version / outside Claude) ----------
    var WEATHER = null, locBusy = false;
    var WMO = { 0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
                66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };
    function locCfg() { return lsGet('pusheen.loc') || { on: false }; }
    function weatherAt(lat, lon) {
      return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,weather_code,is_day&timezone=auto')
        .then(function (r) { return r.json(); }).then(function (j) {
          var c = j && j.current; if (!c) return;
          WEATHER = { temp: Math.round(c.temperature_2m), desc: WMO[c.weather_code] || 'unknown weather', code: c.weather_code, at: Date.now() }; emit('loc');
        });
    }
    function refreshLocation(fromUser) {
      if (locBusy) return Promise.resolve(false);
      var lc = locCfg();
      if (S.loc && S.loc.manual && S.loc.city && !lc.on) {
        // a city typed by you: look it up for the weather (works outside Claude only)
        locBusy = true;
        return fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(S.loc.city)).then(function (r) { return r.json(); })
          .then(function (j) { var g = j && j.results && j.results[0]; if (g) { S.loc.country = g.country || S.loc.country; return weatherAt(g.latitude.toFixed(2), g.longitude.toFixed(2)); } })
          .catch(function () {}).then(function () { locBusy = false; return true; });
      }
      if (!lc.on || !navigator.geolocation) return Promise.resolve(false);
      locBusy = true;
      return new Promise(function (res) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          var lat = pos.coords.latitude.toFixed(2), lon = pos.coords.longitude.toFixed(2);   // about 1 km precision, never stored
          var prevCity = S.loc && S.loc.city;
          fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en&latitude=' + lat + '&longitude=' + lon).then(function (r) { return r.json(); })
            .then(function (j) {
              var city = j.city || j.locality || j.principalSubdivision || '';
              if (city) { S.loc = { city: city, country: j.countryName || '', manual: false, at: Date.now() }; save(); emit('loc'); }
              if (city && city !== prevCity) {
                remember((prevCity ? 'They moved from ' + prevCity + ' to ' : 'They are in ') + city + (j.countryName ? ', ' + j.countryName : '') + '.', 2);
                if (fromUser || prevCity) setTimeout(function () { say(fill(T(prevCity ? 'You\'re in {city} now? ‖ …Huh. Far from {prev}.' : 'So you\'re in {city}. ‖ …I\'ll remember that.'), { city: city, prev: prevCity }), 'content'); }, 900);
              }
              return weatherAt(lat, lon);
            }).catch(function () {}).then(function () { locBusy = false; res(true); });
        }, function (err) { locBusy = false; if (fromUser) emit('note', { text: err && err.code === 1 ? 'Location was refused. You can allow it in your phone settings, or type your city instead.' : 'Couldn\'t get your location right now.' }); res(false); },
        { enableHighAccuracy: false, maximumAge: 30 * 60000, timeout: 15000 });
      });
    }
    function setLocation(on) { var lc = locCfg(); lc.on = !!on; lsSet('pusheen.loc', lc); if (on) return refreshLocation(true); WEATHER = null; if (S.loc && !S.loc.manual) { S.loc = null; save(); } emit('loc'); return Promise.resolve(true); }
    function setCity(name) { name = String(name || '').trim().slice(0, 40); S.loc = name ? { city: name, country: '', manual: true, at: Date.now() } : null; WEATHER = null; save(); emit('loc'); if (name) refreshLocation(false); }

    // ---------- save code: all of her, in one piece of text you can keep or move to another phone ----------
    function b64FromBytes(u8) { var s2 = '', i; for (i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s2); }
    function bytesFromB64(b) { var bin = atob(b), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    function exportCode() {
      var json = JSON.stringify(S), bytes = new TextEncoder().encode(json);
      if (typeof CompressionStream === 'undefined') return Promise.resolve('PSH0:' + b64FromBytes(bytes));
      return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
        .then(function (ab) { return 'PSH1:' + b64FromBytes(new Uint8Array(ab)); });
    }
    function importCode(code) {
      code = String(code || '').replace(/\s+/g, '');
      var m = /^PSH([01]):(.+)$/.exec(code); if (!m) return Promise.reject(new Error('not a Pusheen save code'));
      var bytes = bytesFromB64(m[2]);
      var p2 = m[1] === '0' ? Promise.resolve(bytes) : new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      return p2.then(function (u8) {
        var obj = JSON.parse(new TextDecoder().decode(u8));
        if (!obj || typeof obj.op !== 'number' || !Array.isArray(obj.missions)) throw new Error('this code is damaged');
        S = upgrade(obj); S.saved = Date.now(); save(); flush();
        SCENE.setOwned(S.owned); BODY.setPlaceNow(S.owned.house && S.place === 'house' ? 'house' : 'garden'); BODY.earmuffs(!!S.muted);
        ['state', 'missions', 'points', 'mem', 'opinion', 'feel', 'owned', 'muted', 'loc'].forEach(function (e) { emit(e); });
        setTimeout(function () { say(T('…Oh. ‖ I remember you.') + (S.name ? ' ‖ ' + S.name + '.' : ''), 'surprised'); }, 600);
        return true;
      });
    }

    // ---------- timers she sets herself (she says it on time, even if you left the app) ----------
    function addTimer(sec, text) {
      S.timers = (S.timers || []).filter(function (x) { return x.at > Date.now(); }).slice(-9);
      S.timers.push({ at: Date.now() + Math.min(86400, Math.max(1, sec)) * 1000, text: text.slice(0, 200) }); save();
      var an = android(); if (an && an.notifyAt) try { an.notifyAt(Math.round(sec), 'Pusheen', text.replace(/\s*‖\s*/g, ' ')); } catch (e) {}
    }
    setInterval(function () {
      if (!S.timers || !S.timers.length) return;
      var now = Date.now(), due = S.timers.filter(function (x) { return x.at <= now; });
      if (!due.length) return;
      S.timers = S.timers.filter(function (x) { return x.at > now; }); save();
      due.forEach(function (x, i) {
        if (now - x.at > 6 * 3600e3) return;                     // too late to matter
        if (document.hidden) return;                              // the phone already showed it as a notification
        setTimeout(function () { say(x.text, null, null, { cut: i === 0 }); buzz([90, 60, 90]); }, i * 2500);
      });
    }, 1000);

    // ---------- she can make the phone buzz ----------
    function buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} }

    // ---------- shaking the phone shakes her ----------
    var shakeHits = [], lastJolt = 0, lastDizzy = 0;
    window.addEventListener('devicemotion', function (e) {
      var a = e.acceleration; if (!a || a.x == null) return;
      var mag = Math.sqrt(a.x * a.x + a.y * a.y + (a.z || 0) * (a.z || 0)), now = Date.now();
      if (mag < 13 || document.hidden) return;
      if (now - lastJolt > 110) { lastJolt = now; BODY.jolt(a.x, -a.y, Math.min(3, mag / 12)); }
      shakeHits = shakeHits.filter(function (x) { return now - x < 1600; }); shakeHits.push(now);
      if (shakeHits.length >= 6 && now - lastDizzy > 4500) {
        lastDizzy = now; shakeHits = [];
        BODY.dizzy(); feel('dizzy', 12); heat(temper() === 'kind' || temper() === 'delighted' ? 0.1 : 0.18, 'you shook the phone'); note('shook the whole phone');
        if (S.day) S.day.rough++;
        setTimeout(function () { touchSay(LINES.shook, 'annoyed'); }, 700);
      }
    }, { passive: true });

    // ---------- screen time (app version, with "usage access") ----------
    function fmtMin(m) { m = Math.round(m || 0); if (JA) return m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60 ? m % 60 + '分' : '') : m + '分'; return m >= 60 ? Math.floor(m / 60) + 'h' + pad(m % 60) : m + ' min'; }
    function refreshScreen() {
      var an = android(); if (!an || !an.hasUsageAccess) return;
      try {
        if (!an.hasUsageAccess()) return;
        var st = JSON.parse(an.screenTime()); if (!st || st.total == null) return;
        var day = herDay(), prev = S.screen && S.screen.day === day ? S.screen.total : 0;
        S.screen = { day: day, total: st.total, top: (st.top || []).slice(0, 5), at: Date.now() };
        S.screenHist = S.screenHist || {}; S.screenHist[day] = st.total;
        Object.keys(S.screenHist).sort().slice(0, -14).forEach(function (k) { delete S.screenHist[k]; });
        save(); emit('screen');
        // crossing a big line today: she says something (once per threshold)
        [240, 360, 480].forEach(function (lim) {
          var k = 'scr:' + day + ':' + lim;
          if (st.total >= lim && prev < lim && !S.flags[k] && greeted) { S.flags[k] = 1; setTimeout(function () { sayL(LINES.screenHigh, 'annoyed', null, { t: fmtMin(st.total), app: (st.top && st.top[0] ? st.top[0].app : '') }); }, 1500); }
        });
        open().forEach(function (m) { if (m.screen && st.total > m.screen) { m.status = 'missed'; m.end = Date.now(); S.n.skip++; S.streak = 0; opinion(-3, 'they went over their screen time'); save(); emit('missions'); setTimeout(function () { sayL(LINES.screenFail, 'away', null, { t: fmtMin(st.total) }); }, 2500); } });
      } catch (e) {}
    }
    setInterval(function () { if (!document.hidden) refreshScreen(); }, 15 * 60000);

    // ---------- the alarm: she rings with her voice (app version) ----------
    function syncAlarm() {
      var an = android(); if (!an || !an.setAlarm) return;
      try {
        if (S.wake) { var p2 = S.wake.split(':'); an.setAlarm(+p2[0], +p2[1]); } else an.cancelAlarm();
        an.setAlarmLines(JSON.stringify({ lines: LINES.alarm.map(function (x) { return fill(x, vars({ time: S.wake || '', wake: S.wake || '' })).replace(/\s*‖\s*/g, ' '); }), up: LINES.alarmButtons[0], snooze: LINES.alarmButtons[1] }));
      } catch (e) {}
    }
    function alarmReport() {
      var an = android(); if (!an || !an.alarmLog) return null;
      try {
        var lg = JSON.parse(an.alarmLog()); if (!lg || !lg.fired || lg.fired <= (S.alarmSeen || 0) || Date.now() - lg.fired > 8 * 3600e3) return null;
        S.alarmSeen = lg.fired; S.wakeChecked = herDay(); save();
        var v = vars({ n: lg.snoozes, wake: S.wake || '' });
        if (!lg.stopped && !lg.timedOut) { try { an.alarmStop(); } catch (e) {} lg.stopped = Date.now(); }     // you opened the app: you're up
        if (!lg.stopped) { opinion(-3, 'they slept through my alarm'); remember('I rang for ten minutes at ' + hhmm(new Date(lg.fired)) + '. Nobody came.', 1); return [fill(pickL(LINES.alarmIgnored), v), 'away']; }
        if (!lg.snoozes) { opinion(2.5, 'they got up on the first ring'); return [fill(pickL(LINES.alarmUp), v), 'happy', 'sparkle']; }
        opinion(-0.8 * Math.min(5, lg.snoozes), 'they snoozed my alarm ' + lg.snoozes + ' times');
        if (lg.snoozes >= 3) remember('They snoozed me ' + lg.snoozes + ' times on ' + new Date(lg.fired).toLocaleDateString('en-GB', { weekday: 'long' }) + '.', 1);
        return [fill(pickL(lg.snoozes === 1 ? LINES.alarmSnooze1 : LINES.alarmSnoozeN), v), 'annoyed'];
      } catch (e) { return null; }
    }

    // ---------- hold your finger on her: hug, pat, tickle, high five, brush her hair, give a flower ----------
    var interactLog = {};
    function interact(kind) {
      var now = Date.now(), tm = temper(), li = levelIdx(S.op), late = isLate();
      if (BODY.state === 'fedUp') { touchSay(TOUCH.refuse, 'annoyed'); return; }
      if (BODY.state === 'asleep') BODY.wake();
      var times = interactLog[kind] = (interactLog[kind] || []).filter(function (x) { return now - x < 10 * 60000; }); times.push(now);
      var n = times.length, g = function (x) { return x / n; };          // the same thing over and over means less each time
      var rough = recent.filter(function (e) { return now - e.at < 180000 && /swung|upside|fed up|shook/.test(e.what); }).length;
      var R = LINES.act[kind], out;   // out = [lines, face, moves, opinion, warm, heat, feeling]
      if (kind === 'hug') {
        if (tm === 'grumpy' && li < 9) out = [R.no, 'annoyed', ['shrug'], 0, 0, 0.1, 'annoyed'];
        else if (tm === 'dismissive' && li < 7) out = [R.meh, null, ['cross_arms'], g(0.3), 0.05, 0, 'indifferent'];
        else if (tm === 'sad') out = [R.sad, 'content', ['hug'], g(2.5), 0.5, 0, 'comforted'];
        else if (rough) out = [R.rough, 'content', ['hug'], g(1), 0.2, 0, 'forgiving'];
        else if (li <= 4) out = [R.shy, 'surprised', ['hug'], g(1.2), 0.15, 0, 'flustered'];
        else if (late) out = [R.late, 'content', ['hug'], g(1), 0.15, 0, 'sleepy'];
        else if (li >= 9 || tm === 'kind' || tm === 'delighted') out = [R.love, 'happy', ['hug', 'blush'], g(2), 0.3, 0, 'happy'];
        else out = [R.ok, 'content', ['hug'], g(1.5), 0.2, 0, 'warm'];
      } else if (kind === 'pat') {
        if (tm === 'grumpy') out = [R.grumpy, 'sleep', ['nod'], g(0.6), 0.15, 0, 'secretly pleased'];
        else if (tm === 'dismissive') out = [R.meh, null, ['look_left'], g(0.2), 0.05, 0, 'indifferent'];
        else if (tm === 'sad') out = [R.sad, 'sleep', ['nod'], g(1.5), 0.3, 0, 'comforted'];
        else if (tm === 'kind' || tm === 'delighted' || li >= 9) out = [R.love, 'sleep', ['nod', 'blush'], g(1.2), 0.2, 0, 'content'];
        else out = [R.ok, 'sleep', ['nod'], g(1), 0.15, 0, 'calm'];
      } else if (kind === 'tickle') {
        if (tm === 'grumpy' || li <= 3) out = [R.no, 'annoyed', ['shiver'], g(-1) - 0.3, 0, 0.25, 'annoyed'];
        else if (n >= 3) out = [R.enough, 'annoyed', ['stomp'], -0.5, 0, 0.3, 'tickled out'];
        else out = [R.ok, 'boop', ['wiggle'], g(0.8), 0.15, 0.06, 'giggly'];
      } else if (kind === 'highfive') {
        var doneRecently = S.missions.some(function (m) { return m.status === 'done' && now - m.end < 15 * 60000; });
        if (li <= 2 || (tm === 'grumpy' && chance(0.5))) out = [R.no, null, ['cross_arms'], 0, 0, 0, 'smug'];
        else if (doneRecently) out = [R.mission, 'happy', ['high_five', 'cheer'], g(1.5), 0.2, 0, 'proud'];
        else out = [R.ok, 'happy', ['high_five'], g(0.8), 0.1, 0, 'pleased'];
      } else if (kind === 'brush') {
        if (rough) out = [R.rough, 'content', ['tilt_left'], g(1), 0.2, 0, 'soothed'];
        else if (tm === 'grumpy') out = [R.grumpy, null, ['tilt_right'], g(0.5), 0.1, 0, 'tolerating it'];
        else if (tm === 'kind' || tm === 'delighted') out = [R.love, 'sleep', ['tilt_left', 'blush'], g(1.2), 0.2, 0, 'content'];
        else out = [R.ok, 'sleep', ['tilt_left'], g(1), 0.15, 0, 'calm'];
      } else if (kind === 'flower') {
        S.n.flowers = (S.n.flowers || 0) + 1;
        if (S.n.flowers === 1) remember('They gave me a flower. The first one.', 2);
        if (tm === 'grumpy') out = [R.grumpy, 'content', ['look_left'], g(1), 0.25, 0, 'flustered'];
        else if (tm === 'sad') out = [R.sad, 'content', ['blush'], g(2), 0.4, 0, 'touched'];
        else if (S.n.flowers > 3) out = [R.again, 'happy', ['blush'], g(1), 0.15, 0, 'flustered'];
        else out = [R.ok, 'content', ['blush'], g(1.5), 0.25, 0, 'flustered'];
      }
      if (!out) return;
      note({ hug: 'hugged you', pat: 'patted your head', tickle: 'tickled you', highfive: 'went for a high five', brush: 'brushed your hair', flower: 'gave you a flower' }[kind]);
      if (out[2]) BODY.perform(out[2]);
      if (out[3]) opinion(out[3], { hug: 'a hug', pat: 'a head pat', tickle: 'tickling', highfive: 'a high five', brush: 'brushing my hair', flower: 'a flower' }[kind]);
      if (out[4]) warm(out[4], { hug: 'you hugged me', pat: 'you patted my head', tickle: 'you made me laugh', highfive: 'that high five', brush: 'you brushed my hair', flower: 'you gave me a flower' }[kind]);
      if (out[5]) heat(out[5], kind === 'tickle' ? 'you tickled me too much' : 'you hugged me when I didn\'t want it');
      feel(out[6], 20);
      lastTouchSay = 0; touchSay(out[0], out[1]);
    }

    // ---------- reacting to her body ----------
    var lastTouch = Date.now(), lastTouchSay = 0;
    function touchSay(list, face) { var now = Date.now(); if (now - lastTouchSay < 2600 || busy) return; lastTouchSay = now; say(pickL(list), face, null, { cut: true }); }
    BODY.on(function (type, d) {
      var now = Date.now(), tm = temper();
      if (type === 'touch') { var idleFor = now - lastTouch; lastTouch = now; if (idleFor > 6 * 60000) emit('feel'); }
      if (type === 'woke') {
        feel('groggy', 20);
        if (pendingGreeting) { var g = pendingGreeting; pendingGreeting = null; setTimeout(g, 1200); }
        else if (chance(0.5)) setTimeout(function () { touchSay(LINES.woke, 'sleepy'); }, 900);
        heat(0.08, 'you woke me up');
        return;
      }
      if (type === 'boop') {
        S.n.boops++; if (d.n === 1) note('booped you');
        var hv = { kind: 0.03, delighted: 0.02, calm: 0.06, sad: 0.06, dismissive: 0.07, grumpy: 0.1 }[tm] || 0.06;
        heat(hv * (d.rapid ? 1.6 : 1), 'you kept poking me');
        var many = d.rapid || d.n >= Math.ceil(d.limit * 0.55), soft = tm === 'kind' || tm === 'delighted';
        feel(many ? (soft ? 'flustered' : 'annoyed') : soft ? 'amused' : tm === 'grumpy' ? 'annoyed' : 'surprised', 6);
        var p = many ? 0.6 : (d.n === 1 && now - lastTouchSay > 25000) ? 0.45 : d.n % 3 === 0 ? 0.5 : 0.12;
        if (chance(p)) touchSay((TOUCH.boop[tm] || TOUCH.boop.calm)[many ? 'many' : 'one'], many && !soft ? 'annoyed' : soft ? 'happy' : null);
      }
      if (type === 'buzz') buzz(d.ms || [80]);
      if (type === 'hold') emit('holdmenu', d);
      if (type === 'fedUp') { buzz([70, 50, 70]); note('booped you until you got fed up'); if (S.day) S.day.rough++; heat(0.25, 'you poked me until I snapped'); opinion(-1.5, 'too much poking'); setTimeout(function () { touchSay(TOUCH.fedUp[tm] || TOUCH.fedUp.any, 'annoyed'); }, 300); }
      if (type === 'refused') { if (chance(0.5)) touchSay(TOUCH.refuse, 'annoyed'); }
      if (type === 'calmed') { feel('tired', 15); if (S.day && S.day.reason && !S.day.revealed && S.day.rough >= 2 && chance(0.5)) setTimeout(function () { explainMood(true); }, 900); }
      if (type === 'grab' && d.type === 'arm') {
        note('held your hand');
        if (tm === 'kind' || tm === 'delighted' || tm === 'calm') { warm(0.05, 'you held my hand'); feel(tm === 'calm' ? 'curious' : 'shy', 12); } else { heat(0.04, 'you grabbed my hand'); feel('annoyed', 8); }
        if (chance(0.3)) touchSay(TOUCH.hand[tm] || TOUCH.hand.calm, tm === 'kind' || tm === 'delighted' ? 'content' : null);
      }
      if (type === 'spun') {
        S.n.spins++; note('swung you around by the leg (' + d.turns.toFixed(1) + ' turns)'); if (S.day) S.day.rough++;
        heat(tm === 'kind' || tm === 'delighted' ? 0.12 : 0.22, 'you swung me around'); feel('dizzy', 12); if (d.turns > 2) opinion(-1, 'swung me around');
        if (S.n.spins === 1) remember('They swung me around by my leg. I remember everything.', 2);
        if (chance(0.7)) setTimeout(function () { touchSay(LINES.spun, 'annoyed'); }, 1400);
      }
      if (type === 'upside') { note('held you upside down by the leg'); if (S.day) S.day.rough++; feel('flustered', 10); if (chance(0.35)) touchSay(LINES.upside, null); }
      if (type === 'place') emit('place');
    });
    function note(what) { recent.push({ what: what, at: Date.now() }); if (recent.length > 12) recent.shift(); }

    // ---------- talking to herself when nothing's happening ----------
    var nextIdle = Date.now() + 40000, usedIdle = [], lastMuse = 0;
    function idleGap() { var tm = temper(), k = tm === 'sad' ? 1.7 : tm === 'dismissive' ? 1.4 : tm === 'kind' || tm === 'delighted' ? 0.8 : 1; return (35 + Math.random() * 50) * 1000 * k; }
    function idleLine() {
      var h = hourOf(), tm = temper(), li = levelIdx(S.op), cand = [];
      var addP = function (arr, w) { (arr || []).forEach(function (x) { for (var i = 0; i < w; i++) cand.push(x); }); };
      addP(IDLE.any, 1); addP(IDLE[h < 11 && h >= 5 ? 'morning' : h < 17 ? 'day' : h < 21 ? 'evening' : 'night'], 2);
      addP(IDLE[SCENE.season()], 1); addP(IDLE[tm], 3); addP(li <= 4 ? IDLE.low : li >= 9 ? IDLE.high : null, 2);
      if (BODY.place === 'house') addP(IDLE.house, 2);
      if (S.owned.bookshelf && !S.owned.books) addP(LINES.emptyShelf, 3);
      else if (!S.owned.house && S.n.done >= 1) addP(LINES.wish, 1);
      if (hunger() > 0.7) addP(T(['I could eat something. ‖ Not that I need to.', 'Is there… food. ‖ Out there. For me.', 'I\'m not hungry. ‖ …I\'m a little hungry.']), 2);
      if (WEATHER && S.loc) {
        var wc = WEATHER.code;
        if (wc >= 51 && wc <= 67 || wc >= 80 && wc <= 82) addP([fill(T("It's raining in {city}. ‖ Take an umbrella if you go out."), { city: S.loc.city }), T('Rain where you are. ‖ Here it never rains. I checked.')], 2);
        else if (wc >= 71 && wc <= 86) addP([fill(T('Snow in {city}. ‖ Lucky.'), { city: S.loc.city })], 2);
        else if (WEATHER.temp >= 28) addP([fill(T("It's {t}° where you are. ‖ Drink water."), { t: WEATHER.temp })], 2);
        else if (WEATHER.temp <= 3) addP([fill(T("It's {t}° where you are. ‖ Wear something warm."), { t: WEATHER.temp })], 2);
      }
      var om = open(); if (om.length) cand.push(fill(T('Have you done the {m} thing yet? ‖ Just asking.'), { m: JA ? om[0].text : om[0].text.toLowerCase() }));
      if (S.name && chance(0.2)) cand.push(fill(T('{name}. ‖ …Just checking you\'re still there.'), { name: S.name }));
      if (S.study && S.study.week === weekKey() && chance(0.5)) { var stp = studyTopic(S.study); addP(LINES.studyIdle.map(function (x) { return fill(x, { topic: JA ? stp.ja : stp.en }); }), 1); }
      cand = cand.filter(function (c) { return usedIdle.indexOf(c) < 0; });
      if (!cand.length) { usedIdle = []; return null; }
      var line = pickL(cand); usedIdle.push(line); if (usedIdle.length > 16) usedIdle.shift();
      return fill(line, vars());
    }
    function idleTick() {
      var now = Date.now();
      if (document.hidden || BODY.state !== 'awake' || busy || UIBUSY_B() || now < nextIdle || !greeted) return;
      if (now - lastPlayerAt < 45000 || now - lastSpoke < 25000) { nextIdle = now + 15000; return; }
      nextIdle = now + idleGap();
      // with your own key, she sometimes thinks up something herself (only while you're actually around)
      var kind = brainKind();
      if ((kind === 'openrouter' || kind === 'anthropic') && now - lastMuse > 4 * 60000 && now - Math.max(lastPlayerAt, lastTouch) < 10 * 60000 && chance(0.4)) {
        lastMuse = now; respond('Nobody said anything for a while. Say something on your own, unprompted: a short thought, observation, question or reminder that fits this moment, your mood and the time. Don\'t greet. Keep it short.', { silent: true });
        return;
      }
      var l = idleLine(); if (l) say(l, chance(0.3) ? 'down' : null, null, { quiet: true });
    }

    // ---------- little games: points for playing (capped per day) ----------
    var GAME_CAP = 80;
    function gameReward(id, sec, perf) {
      var d = herDay(); if (!S.games || S.games.day !== d) S.games = { day: d, pts: 0, n: 0 };
      S.games.n++;
      var base = sec / 60 * 4 * (id === 'read' ? 1.5 : 1), pts = Math.max(1, Math.round(base * (0.5 + 0.5 * Math.min(1.2, perf || 0))));
      pts = Math.max(0, Math.min(pts, GAME_CAP - S.games.pts));
      if (pts) { S.games.pts += pts; S.points += pts; emit('points'); }
      save(); return pts;
    }
    function gameDone(id, reason, res, pts) {
      lastPlayerAt = Date.now(); greeted = true; nextIdle = Date.now() + idleGap() + 20000;
      var G = LINES.game, perf = res && res.perf || 0, list, face = null, st = S.study, tp = st ? studyTopic(st) : null;
      note('played a little game with you (' + id + ')');
      if (reason === 'quit') { list = G.quit; face = 'away'; }
      else if (reason === 'idle') { list = G.idle; face = 'annoyed'; }
      else {
        opinion(0.6, 'they played one of my games'); warm(0.08, 'we played a game together');
        if (perf >= 0.9) { BODY.perform(['clap']); feel('impressed', 30); } else feel('amused', 20);
        if (id === 'read' && tp && brainKind() !== 'off') {
          return respond('They just finished a reading session in your games on this week\'s topic, "' + tp.en + '", and got ' + (res.line || '') + '. React in character, briefly: maybe one interesting detail about the topic, or ask them one question about it. Don\'t list facts.', { silent: true });
        }
        list = !pts ? G.capped : id === 'read' ? G.read : perf >= 0.9 ? G.good : G.ok; face = perf >= 0.9 ? 'happy' : 'content';
      }
      setTimeout(function () { say(fill(pickL(list), vars({ pts: pts, topic: tp ? (JA ? tp.ja : tp.en) : '' })), face, null, { cut: true }); }, 500);
    }

    // ---------- the weekly reading topic: short texts, quizzes, and old questions coming back (spaced repetition) ----------
    var BOX_MS = [0, 5 * 60000, 864e5, 3 * 864e5, 8 * 864e5, 21 * 864e5], studyServed = {};
    function studyIdx() { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return Math.round((d.getTime() - STUDY.EPOCH) / (7 * 864e5)); }
    function studyTopic(st) {
      if (st.custom) return { id: 'custom:' + st.custom, en: st.custom, ja: st.custom, about: '', custom: true };
      return STUDY.TOPICS.filter(function (t) { return t.id === st.topic; })[0] || STUDY.TOPICS[0];
    }
    function studyWeek() {
      var wk = weekKey(), st = S.study;
      if (!st || st.week !== wk) {
        var list = brainKind() === 'off' ? STUDY.TOPICS.filter(function (t) { return STUDY.PACKS[t.id]; }) : STUDY.TOPICS, i = studyIdx(), n = list.length;
        S.study = st = { week: wk, topic: list[((i % n) + n) % n].id, custom: null, texts: [], read: {}, right: 0, wrong: 0 };
        save();
      }
      return st;
    }
    function studyPack(st) { var tp = studyTopic(st); return !tp.custom && STUDY.PACKS[tp.id] && !(JA && brainKind() !== 'off') ? STUDY.PACKS[tp.id] : []; }
    function studyTexts(st) { return studyPack(st).concat(st.texts); }
    function studyServe(x, st) {
      var tp = studyTopic(st);
      st.read[x.id] = (st.read[x.id] || 0) + 1; st.lastRead = x.id; save();
      var t = { id: x.id, title: x.title, body: x.body, again: st.read[x.id] > 1, qs: x.qs.map(function (q, k) { return { id: x.id + '.' + k, q: q[0], o: q[1], t: tp.id, tn: JA ? tp.ja : tp.en }; }) };
      t.qs.forEach(function (q) { studyServed[q.id] = q; });
      return t;
    }
    function studyGen(st, all) {
      var tp = studyTopic(st);
      var prompt = [
        'You write short study texts for a reading game inside a phone app. The aim: by the end of the week, the reader knows this one topic really well.',
        'Topic of the week: ' + (JA ? tp.ja + ' (' + tp.en + ')' : tp.en) + (tp.about ? ' — covering ' + tp.about : '') + '.',
        'This is text ' + (all.length + 1) + ' of at most 7 this week.' + (all.length ? ' Already covered, do not repeat them; go deeper or cover another important part: ' + all.map(function (x) { return '"' + x.title + '"'; }).join(', ') + '.' : ' Start with a clear overview of the essentials.'),
        'Write one text of ' + (JA ? 'about 400 to 550 Japanese characters' : '170 to 230 words') + ': accurate and concrete (names, dates, numbers, how things work), plain clear language, connected sentences, no lists or headings. Only state facts you are sure of.',
        'Then write 3 multiple-choice questions answerable from the text, testing its most important facts. Each has exactly 3 options: the correct one FIRST, then two plausible wrong ones of similar length.',
        JA ? 'Write the title, text, questions and options in natural Japanese.' : 'Write in English.',
        'Reply with JSON only: {"title": "short title", "body": "the text", "questions": [{"q": "question", "options": ["correct", "wrong", "wrong"]}]}'
      ].join('\n');
      return Promise.race([callAI(prompt, false, null, 1800), new Promise(function (_, rej) { setTimeout(function () { rej({ code: 'timeout' }); }, 45000); })]).then(function (r) {
        var qs = (r && Array.isArray(r.questions) ? r.questions : []).filter(function (q) { return q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length >= 3; })
          .slice(0, 4).map(function (q) { return [q.q.slice(0, 220), q.options.slice(0, 3).map(function (o) { return String(o).slice(0, 140); })]; });
        if (!r || typeof r.body !== 'string' || r.body.length < (JA ? 150 : 400) || qs.length < 2) throw { code: 'bad_text' };
        var x = { id: 'g' + Date.now().toString(36), title: String(r.title || tp.en).slice(0, 90), body: r.body.slice(0, 3000), qs: qs };
        st.texts.push(x); save(); return x;
      });
    }
    function studyNext() {
      var st = studyWeek(), all = studyTexts(st), ai = brainKind() !== 'off';
      var unread = all.filter(function (x) { return !st.read[x.id]; });
      function reread() {
        if (!all.length) return null;
        var pool = all.filter(function (x) { return x.id !== st.lastRead; }); if (!pool.length) pool = all;
        pool.sort(function (a, b) { return (st.read[a.id] || 0) - (st.read[b.id] || 0); });
        return studyServe(pool[0], st);
      }
      if (unread.length) return Promise.resolve(studyServe(unread[0], st));
      if (ai && all.length < 7) return studyGen(st, all).then(function (x) { return studyServe(x, st); }, function () { return reread(); });
      return Promise.resolve(reread());
    }
    function studyCardKey(tp) { return tp.custom ? tp.id : tp.id; }
    function studyReview(n, exclude) {
      var st = studyWeek(), tp = studyTopic(st), now = Date.now(), C = S.cards || (S.cards = {}), key = studyCardKey(tp);
      var due = Object.keys(C).filter(function (id) { return C[id].due <= now && (!exclude || id.indexOf(exclude + '.') !== 0); })
        .map(function (id) { var c = C[id]; return { id: id, q: c.q, o: c.o, box: c.box, due: c.due, t: c.t, tn: c.tn }; });
      var cur = due.filter(function (c) { return c.t === key; }).sort(function (a, b) { return a.box - b.box || a.due - b.due; });
      var old = due.filter(function (c) { return c.t !== key; }).sort(function (a, b) { return a.due - b.due; });
      var out = cur.slice(0, n), olds = 0;
      while (out.length < n && old.length && olds < 2) { out.push(old.shift()); olds++; }
      if (old.length && !olds && out.length && chance(0.4)) { out[out.length - 1] = old.shift(); }   // an older topic comes back now and then
      return out.map(function (c) { return { id: c.id, q: c.q, o: c.o, rev: true, from: c.t !== key ? c.tn : null }; });
    }
    function studyAnswer(id, right) {
      var C = S.cards || (S.cards = {}), c = C[id], st = studyWeek(), now = Date.now();
      if (!c) { var q = studyServed[id]; if (!q) return; c = C[id] = { q: q.q, o: q.o, t: q.t, tn: q.tn, box: right ? 1 : 0, n: 0, ok: 0 }; }
      c.n++; if (right) { c.ok++; c.box = Math.min(5, c.box + 1); } else c.box = 1;
      c.due = now + BOX_MS[c.box]; c.at = now;
      if (right) st.right = (st.right || 0) + 1; else st.wrong = (st.wrong || 0) + 1;
      var ids = Object.keys(C);
      if (ids.length > 260) ids.sort(function (a, b) { return (C[b].box - C[a].box) || (C[a].at - C[b].at); }).slice(0, ids.length - 260).forEach(function (k) { delete C[k]; });
      save();
    }
    function studyInfo() {
      var st = studyWeek(), tp = studyTopic(st), C = S.cards || {}, key = studyCardKey(tp), now = Date.now();
      var mine = Object.keys(C).filter(function (k) { return C[k].t === key; }), all = studyTexts(st), ai = brainKind() !== 'off';
      var d = new Date(); var left = 7 - (d.getDay() + 6) % 7;
      return { name: JA ? tp.ja : tp.en, en: tp.en, custom: !!tp.custom, ai: ai, read: Object.keys(st.read).length, total: ai ? Math.max(7, all.length) : all.length,
               cards: mine.length, known: mine.filter(function (k) { return C[k].box >= 3; }).length,
               due: Object.keys(C).filter(function (k) { return C[k].due <= now; }).length, daysLeft: left, englishPack: JA && !ai && studyPack(st).length > 0, right: st.right || 0, wrong: st.wrong || 0 };
    }
    function studySetTopic(name) {
      var st = studyWeek(); name = String(name || '').trim().slice(0, 60);
      st.custom = name || null; st.texts = []; st.read = {}; st.lastRead = null; save(); emit('study');
    }
    var UIBUSY_B = function () { return false; };

    // ---------- the clock keeps running while you're here ----------
    var lastNag = Date.now(), ticks = 0, lastPlaceThink = Date.now();
    setInterval(idleTick, 5000);
    setInterval(function () {
      if (document.hidden) return;
      var now = Date.now();
      S.lastSeen = now;
      if (herDay() !== (S.day && S.day.date)) rollDay();
      if (S.day) { S.day.heat = (S.day.heat || 0) * 0.92; S.day.warm = (S.day.warm || 0) * 0.97; }
      applyTemper(); emit('feel');
      var ev = resolveMissions(S.lastSeen);
      ev.forEach(function (e) {
        if (e[0] === 'caught') say(fill(pickL(LINES.caught), vars({ bed: e[1].bedLabel })), 'annoyed', 'sulk');
        if (e[0] === 'dark') drop(e[1].id, LINES.dropDark[0]);
      });
      if (isLate() && !isExcused() && now - lastNag > 15 * 60000 && now - lastPlayerAt > 60000) {
        lastNag = now; if (S.lastLate !== herDay()) { S.lastLate = herDay(); weekRec().late++; }
        sayL(LINES.lateAgain, 'annoyed');
      }
      // she decides where she wants to be
      if (S.owned.house && now - lastPlaceThink > 5 * 60000 && BODY.state === 'awake' && !busy && now - lastPlayerAt > 60000) {
        lastPlaceThink = now; var h = hourOf(), night = h >= 21 || h < 6, tm = temper();
        if (BODY.place === 'garden' && (night || ((tm === 'sad' || tm === 'dismissive') && chance(0.4)) || chance(0.12))) goPlace('house');
        else if (BODY.place === 'house' && !night && chance(0.3)) goPlace('garden');
      }
      musicTick();
      if (++ticks % 10 === 0) save(); else lsSet(LS_STATE, S);
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { S.lastSeen = Date.now(); hiddenAt = Date.now(); save(); flush(); }
      else { if (hiddenAt && Date.now() - hiddenAt > 5 * 60000) openedAt = Date.now(); if (Date.now() - S.lastSeen > 30 * 60000) arrive(); }
    });

    return {
      on: function (fn) { listeners.push(fn); },
      start: function () {
        SCENE.setOwned(S.owned);
        if (S.owned.house && S.place === 'house') BODY.setPlaceNow('house');
        window.pusheenMusic = onMusic;
        BODY.earmuffs(!!S.muted);
        if (window.claude && claude.use) claude.use('sample').then(function (sm) { if (sm && sm.limits) return sm.limits().then(function (l) { photoOk = !!(l && l.images); emit('ai'); }); }).catch(function () {});
        setTimeout(function () { refreshLocation(false); syncAlarm(); }, 4000);
        setInterval(function () { if (!document.hidden) refreshLocation(false); }, 30 * 60000);
        return connect().then(function () {
          SCENE.setOwned(S.owned); if (S.owned.house && S.place === 'house' && BODY.place !== 'house') BODY.setPlaceNow('house'); arrive();
          var an = android(); if (an) setTimeout(function () { try { onMusic(JSON.parse(an.nowPlaying())); } catch (e) {} }, 5000);
        });
      },
      nowPlaying: function () { return NOW.playing ? { label: NOW.label, app: NOW.app, verdict: NOW.verdict } : null; },
      android: android,
      setMuted: setMuted, get muted() { return !!S.muted; },
      games: { reward: gameReward, done: gameDone, today: function () { return S.games && S.games.day === herDay() ? S.games : { pts: 0, n: 0 }; }, cap: GAME_CAP },
      study: { next: studyNext, review: studyReview, answer: studyAnswer, info: studyInfo, setTopic: studySetTopic, topicName: function () { return studyInfo().name; } },
      interact: interact, screen: function () { return S.screen && S.screen.day === herDay() ? S.screen : null; }, refreshScreen: refreshScreen, fmtMin: fmtMin,
      exportCode: exportCode, importCode: importCode,
      setLocation: setLocation, setCity: setCity, locOn: function () { return !!locCfg().on; }, place: function () { return S.loc; }, weather: function () { return WEATHER; },
      canSeePhotos: function () { var k = brainKind(); return k === 'openrouter' || k === 'anthropic' || (k === 'claude' && photoOk); },
      hunger: hunger,
      hear: hear,
      askMission: function () {
        if (open().length >= 3) { say(T('You have three open already. ‖ Finish one first.'), 'annoyed'); return; }
        addLog('p', '(asks you for a mission)');
        if (brainKind() === 'off') return setTimeout(function () { giveMission(); }, 600);
        respond('The player asks you for a mission. Give exactly one that fits their situation and the time right now, phrased casually in "say" (like "You could … today.", then optionally " ‖ " and what the points could buy you), with the "mission" field filled.');
      },
      askFood: function () { hear(JA ? '何食べたらいい？' : /^fr/i.test(navigator.language || '') ? 'Qu\'est-ce que je mange ?' : 'What should I eat?'); },
      flushNow: function () { save(); flush(); },
      complete: complete, skip: skip, buy: buy, shop: function () { return SHOP.map(function (it) { return Object.assign({ state: shopState(it), have: S.owned[it.id] || 0 }, it); }); },
      toggleHouse: function () {
        if (!S.owned.house) return;
        var to = BODY.place === 'house' ? 'garden' : 'house';
        if (temper() === 'dismissive' && chance(0.35)) return sayL(LINES.refuseMove, 'away');
        goPlace(to);
      },
      setName: function (n) { S.name = String(n || '').trim().slice(0, 30); save(); emit('name'); },
      setWake: setWake,
      get state() { return S; }, missions: function () { return S.missions; }, open: open,
      feelings: function () { return { mood: moodName(), moodLabel: MOOD_LABEL[temper()] || temper(), emotion: emotion(), sulking: Date.now() < S.sulkUntil }; },
      level: function () { var i = levelIdx(S.op); return { i: i, name: levelName(i), custom: !!S.levelNames[i], value: S.op, count: LEVELS.length, starts: LEVELS.map(function (l) { return l[0]; }) }; },
      getCfg: function () { return Object.assign({}, cfg); },
      setCfg: function (c) { cfg = Object.assign(cfg, c); lsSet(LS_CFG, cfg); emit('ai'); },
      status: aiStatus, kind: brainKind, storage: function () { return storage; },
      setBusyCheck: function (fn) { UIBUSY_B = fn; },
      get busy() { return busy; },
      reset: function () {
        S = fresh(); SCENE.setOwned({}); if (BODY.place === 'house') BODY.setPlaceNow('garden');
        save(); flush();
        emit('state'); emit('missions'); emit('points'); emit('mem'); emit('opinion'); emit('feel');
        setTimeout(arrive, 400);
      }
    };
  })();
