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
      if (emo.name && Date.now() < emo.until) return emo.name;
      if (Date.now() < S.sulkUntil) return 'sulking';
      if (Date.now() - Math.max(lastPlayerAt, lastTouch) > 6 * 60000 && greeted) return 'bored';
      return EMO_DEFAULT[moodName()] || 'calm';
    }
    function applyTemper() { BODY.setTemper(temper()); var h = hourOf(); BODY.setSleepAfter(h >= 23 || h < 6 ? 70 : moodName() === 'sad' ? 110 : 170); }
    function shiftMood(to, why) {
      var d = S.day; if (!d || d.mood === to) return;
      d.shifts = (d.shifts || []).concat([{ at: Date.now(), from: d.mood, to: to, why: why }]).slice(-6);
      var from = d.mood; d.mood = to; d.reason = why; d.revealed = false; d.heat = 0; d.warm = 0;
      applyTemper(); emit('feel'); save();
      var L = LINES.shift[to] || LINES.shift.calm;
      setTimeout(function () { sayL(L, to === 'grumpy' ? 'annoyed' : to === 'sad' ? 'down' : to === 'dismissive' ? 'away' : 'content'); }, 1200);
      if (to === 'grumpy' || to === 'sad') remember('I was ' + from + ' today until ' + why + '.', 1);
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
      { id: 'record', name: 'Record player', price: 75, where: 'house', needs: 'house', desc: 'For listening together.' }
    ];
    function wish() { return !S.owned.house ? 'a house' : !S.owned.bookshelf ? 'a bookshelf' : 'books'; }
    function vars(extra) { return Object.assign({ time: hhmm(), name: S.name || 'you', wish: wish() }, extra || {}); }

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
      S.day = { date: d, mood: mood, reason: reason, revealed: false, rough: 0, heat: 0, warm: 0, shifts: [] };
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
      S.missions.push(m); if (S.missions.length > 60) S.missions.splice(0, S.missions.length - 60);
      save(); emit('missions'); return m;
    }
    function localMission() {
      var h = hourOf(), slot = h >= 22 || h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : 'evening';
      var recentT = S.missions.slice(-6).map(function (m) { return m.text; });
      var pool = POOL[slot].filter(function (p) { return recentT.indexOf(p[0]) < 0; }); if (!pool.length) pool = POOL[slot];
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
      var have = S.owned[it.id] || 0;
      if (it.max ? have >= it.max : have) return 'owned';
      if (it.needs && !S.owned[it.needs]) return 'locked';
      return S.points >= it.price ? 'buy' : 'poor';
    }
    function buy(id) {
      var it = SHOP.filter(function (x) { return x.id === id; })[0]; if (!it || shopState(it) !== 'buy') return false;
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
      text = String(text || '').trim().slice(0, 180); if (!text) return;
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
      lines.push('- Player\'s local time: ' + hhmm(d) + ', ' + dayName + ' (' + SCENE.season() + '). Your sky shows the same.');
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
      if (S.wake) lines.push('- They asked you to check they wake up at ' + S.wake + ' (you check when they open the app in the morning; you cannot ring an alarm yet).');
      var liked = [], hated = []; Object.keys(S.music).forEach(function (k) { (S.music[k].v === 'like' ? liked : hated).push(S.music[k].t); });
      if (liked.length || hated.length) lines.push('- Music you judged before: liked ' + (liked.slice(-5).join(', ') || 'nothing') + '; hated ' + (hated.slice(-5).join(', ') || 'nothing') + '. Keep your taste consistent.');
      var rc = recent.filter(function (e) { return Date.now() - e.at < 150000; }).map(function (e) { return e.what; });
      if (rc.length) lines.push('- Just now, physically: ' + rc.join(', ') + '.');
      return lines.join('\n');
    }
    function buildPrompt(directive) {
      var convo = S.log.slice(-18).map(function (l) {
        return (l.who === 'p' ? 'Player' : l.who === 's' ? 'You' : 'Note') + ' [' + hhmm(new Date(l.at)) + ']: ' + l.text;
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
        '- Always reply in the language the player writes in.',
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
    function callAI(prompt, quick) {
      var kind = brainKind();
      if (kind === 'claude') return sampleFn.json(prompt, { modelTier: quick ? 'quick' : 'default', cache: false }).catch(function (e) {
        if (e && e.code === 'not_granted') { sampleDenied = true; emit('ai'); }
        throw e;
      });
      if (kind === 'openrouter') return fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key, 'X-Title': 'Pusheen' },
          body: JSON.stringify({ model: cfg.model || 'openrouter/auto', max_tokens: 900, temperature: 0.85, messages: [{ role: 'user', content: prompt }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose(r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content); });
      if (kind === 'anthropic') return fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: cfg.model || 'claude-sonnet-5-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] })
        }).catch(netFail).then(okJson).then(function (r) { return parseLoose((r.content || []).map(function (c) { return c.text || ''; }).join('')); });
      return Promise.reject({ code: 'off' });
    }
    function aiStatus() {
      var k = brainKind();
      if (k === 'claude') return { kind: k, text: 'Thinking with Claude (built into this page). No key needed here.' };
      if (k === 'openrouter') return { kind: k, text: 'Thinking with your OpenRouter key' + (cfg.model ? ' (' + cfg.model + ')' : '') + '.' };
      if (k === 'anthropic') return { kind: k, text: 'Thinking with your Anthropic key' + (cfg.model ? ' (' + cfg.model + ')' : '') + '.' };
      if (cfg.provider === 'off') return { kind: k, text: 'Brain switched off: she only uses her built-in lines.' };
      if (sampleDenied) return { kind: k, text: 'Claude access was declined for this page, so she only uses her built-in lines.' };
      return { kind: k, text: 'No brain connected: she only uses her built-in lines. Add a key below.' };
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
    function hear(text) {
      text = String(text || '').trim().slice(0, 400); if (!text) return;
      lastPlayerAt = Date.now(); addLog('p', text); trackMsg(text); emit('heard', { text: text });
      BODY.wake(); greeted = true; nextIdle = Date.now() + idleGap() + 30000;
      if (brainKind() === 'off') { setTimeout(function () { localReply(text); }, 500 + Math.random() * 500); return; }
      respond();
    }
    function respond(directive, opts) {
      if (busy) return;
      busy = true; emit('thinking', true); emit('feel');
      var lastP = S.log.filter(function (l) { return l.who === 'p'; }).slice(-1)[0], askedAt = Date.now();
      callAI(buildPrompt(directive)).then(function (r) { applyReply(r || {}, lastP ? lastP.text : ''); })
        .catch(function (e) { if (!(opts && opts.silent)) onAIError(e, lastP ? lastP.text : ''); })
        .then(function () {
          busy = false; emit('thinking', false); emit('feel');
          var newer = S.log.filter(function (l) { return l.who === 'p' && l.at > askedAt; }).length;
          if (newer) respond(); else compact();
        });
    }
    function onAIError(e, text) {
      var code = e && e.code;
      if (code === 'not_granted') { emit('note', { text: 'Claude access was declined, so she\'s on built-in lines now. You can change that in the page\'s permissions.' }); localReply(text); }
      else if (code === 'rate_limited') say('…My head is full. ‖ Give me a minute.', 'down');
      else if (code === 'blocked') { emit('note', { text: 'This page can\'t reach ' + (brainKind() === 'anthropic' ? 'api.anthropic.com' : 'openrouter.ai') + ' from here (inside Claude, outside sites are blocked). Your key will work in the app version. Using built-in lines for now.' }); localReply(text); }
      else if (/^http_40[13]$/.test(code)) { emit('note', { text: 'The key was refused (' + code.slice(5) + '). Check it in Settings.' }); localReply(text); }
      else say('…I lost my train of thought.', 'down');
    }
    function applyReply(r, playerText) {
      var text = String(r.say || '').trim().slice(0, 700) || '…', act = r.act;
      if (r.name && typeof r.name === 'string' && r.name.length < 30) { S.name = r.name.trim(); emit('name'); }
      if (r.song && r.song.title) {
        var v = judgeSong(r.song.title, r.song.verdict);
        act = v === 'like' ? 'vibe' : 'hate_music';
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
      if (r.go === 'inside' || r.go === 'outside') setTimeout(function () { goPlace(r.go === 'inside' ? 'house' : 'garden', true); }, 2500);
      save();
    }
    function localReply(text) {
      var t = text.toLowerCase(), m;
      if ((m = /(?:my name is|i'?m called|call me|je m'?appelle|appelle[- ]moi)\s+([^\s,.!?]{2,20})/i.exec(text))) { S.name = m[1]; save(); emit('name'); opinion(1); return sayL(LINES.named, 'content'); }
      if (isLate() && !isExcused()) {
        if (/work|shift|exam|study|insomnia|can'?t sleep|sick|baby|flight|travel|boulot|travail|examen|r[ée]vis|malade|insomnie|dors pas|bébé|bebe|vol\b/.test(t)) { S.excuse = { day: herDay(), text: text.slice(0, 120) }; save(); return sayL(LINES.excuseOk, 'neutral'); }
        return sayL(LINES.excuseNo, 'annoyed');
      }
      if ((m = SONG_RX.exec(text))) {
        var title = (m[1] || m[2] || '').trim(), v = judgeSong(title); save();
        return v === 'like' ? sayL(LINES.likeSong, 'sleepy', 'vibe') : sayL(LINES.hateSong, 'annoyed', 'hate_music');
      }
      if ((m = /(?:wake me|r[ée]veille[- ]moi|alarm|r[ée]veil).*?(\d{1,2})(?:[:h](\d{2}))?/i.exec(text))) {
        var hh = pad(+m[1] % 24) + ':' + (m[2] || '00'); setWake(hh); return say('Okay. ' + hh + '. ‖ I\'ll check when you open the app. I can\'t ring yet — I\'m a garden, not a clock.', 'neutral');
      }
      if (/why|pourquoi|what'?s wrong|qu'?est-ce qui va pas|mood|angry|sad|f[aâ]ch|triste|mad\b/.test(t)) return explainMood(false);
      if (/hungry|eat|food|dinner|lunch|breakfast|cook|recipe|faim|manger|cuisin|recette|d[îi]ner|d[ée]jeuner/.test(t)) return say(pickL(DISHES[SCENE.season()]) + ' ‖ I\'d cook with you, but my brain isn\'t connected.', 'neutral');
      if (/mission|task|what should i do|quoi faire|t[âa]che/.test(t)) { if (open().length >= 3) return say('You have three already. ‖ Do those first.', 'annoyed'); return giveMission(); }
      if (/i did it|done|finished|fini|j'?ai fait|c'?est fait/.test(t)) return say('Tick it in the missions list. ‖ I trust you. Mostly.', 'content');
      if (/(go|let'?s go) (inside|in|home)|rentre/.test(t) && S.owned.house) return goPlace('house');
      if (/(go|let'?s go) out(side)?|sors|dehors/.test(t) && S.owned.house) return goPlace('garden');
      if (/love you|like you|t'?aime|cute|mignonne|pretty|jolie|thank|merci/.test(t)) { opinion(1, 'they said something nice'); warm(0.15, 'you said something nice'); return say(pickL(['…Okay. ‖ Thanks.', 'Hm. ‖ …You too. I guess.', "Don't say things like that so suddenly."]), 'content'); }
      if (/^(hi|hey|hello|yo|salut|bonjour|coucou|bonsoir)\b/.test(t)) return sayL(LINES.greet[temper()] || LINES.greet.calm, temper() === 'kind' ? 'content' : 'neutral');
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
      S.wake = hh ? pad(+hh.split(':')[0]) + ':' + hh.split(':')[1] : null; S.wakeChecked = S.wake ? '' : S.wakeChecked; save(); emit('wake');
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
        else queue.push([fill(pickL(LINES.missed), v), 'away']);
      });
      var late = isLate();
      if (late && !isExcused()) {
        if (S.lastLate !== herDay()) { S.lastLate = herDay(); weekRec().late++; opinion(-1, 'up too late'); }
        S.sulkUntil = Math.max(S.sulkUntil, now + 10 * 60000); applyTemper();
        queue.push([fill(pickL(LINES.late), vars()), 'annoyed', null, function () { return !isExcused(); }]);
      }
      var wk = wakeCheck(); if (wk) queue.push(wk);
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
      if (type === 'fedUp') { note('booped you until you got fed up'); if (S.day) S.day.rough++; heat(0.25, 'you poked me until I snapped'); opinion(-1.5, 'too much poking'); setTimeout(function () { touchSay(TOUCH.fedUp[tm] || TOUCH.fedUp.any, 'annoyed'); }, 300); }
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
      var om = open(); if (om.length) cand.push('Have you done the ' + om[0].text.toLowerCase() + ' thing yet? ‖ Just asking.');
      if (S.name && chance(0.2)) cand.push(S.name + '. ‖ …Just checking you\'re still there.');
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
      if (++ticks % 10 === 0) save(); else lsSet(LS_STATE, S);
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { S.lastSeen = Date.now(); save(); flush(); }
      else if (Date.now() - S.lastSeen > 30 * 60000) arrive();
    });

    return {
      on: function (fn) { listeners.push(fn); },
      start: function () {
        SCENE.setOwned(S.owned);
        if (S.owned.house && S.place === 'house') BODY.setPlaceNow('house');
        return connect().then(function () { SCENE.setOwned(S.owned); if (S.owned.house && S.place === 'house' && BODY.place !== 'house') BODY.setPlaceNow('house'); arrive(); });
      },
      hear: hear,
      askMission: function () {
        if (open().length >= 3) { say('You have three open already. ‖ Finish one first.', 'annoyed'); return; }
        addLog('p', '(asks you for a mission)');
        if (brainKind() === 'off') return setTimeout(function () { giveMission(); }, 600);
        respond('The player asks you for a mission. Give exactly one that fits their situation and the time right now, phrased casually in "say" (like "You could … today.", then optionally " ‖ " and what the points could buy you), with the "mission" field filled.');
      },
      askFood: function () { hear(/^fr/i.test(navigator.language || '') ? 'Qu\'est-ce que je mange ?' : 'What should I eat?'); },
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
