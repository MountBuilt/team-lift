import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFrom, feedLine, stepsComment, workoutsComment, weightComment, banterFresh,
  nicknameLine, STRETCH_ROASTS, TEN_K_LINES, NICKNAMES, CHALLENGE_QUIPS,
  hasAnyLog, emptyDayStreak, restDayStatus, REST_GRACE_DAYS
} from '../js/lib/banter.js';
import { weightAxisBounds } from '../js/lib/aggregate.js';

const users = [
  { id: 'u1', name: 'Sam', color: '#f97316' },
  { id: 'u2', name: 'Alex', color: '#22d3ee' },
  { id: 'u3', name: 'Bruce', color: '#a3e635' }
];
const e = (userId, date, fields = {}) => ({
  userId, name: users.find(u => u.id === userId).name, date,
  weight: null, steps: null, workoutParts: null, updatedAt: 0, ...fields
});

test('pickFrom is deterministic and in range', () => {
  const arr = ['a', 'b', 'c'];
  assert.equal(pickFrom(arr, 'seed-x'), pickFrom(arr, 'seed-x'));
  assert.ok(arr.includes(pickFrom(arr, 'anything')));
});

test('feedLine is stable for the same entry', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['legs', 'chest'], updatedAt: 42 });
  assert.equal(feedLine(entry), feedLine(entry));
});

test('feedLine roasts stretching-only workouts', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['stretching'], updatedAt: 7 });
  assert.ok(STRETCH_ROASTS.includes(feedLine(entry)));
});

test('feedLine hypes a real workout and names the parts', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['legs', 'back'], updatedAt: 3 });
  const line = feedLine(entry);
  assert.ok(line.includes('legs + back'));
  assert.ok(!STRETCH_ROASTS.includes(line));
});

test('feedLine calls out exactly 10,000 steps', () => {
  const entry = e('u2', '2026-07-08', { steps: 10000, updatedAt: 5 });
  assert.ok(TEN_K_LINES.includes(feedLine(entry)));
});

test('feedLine mentions steps and weigh-in alongside a workout', () => {
  const entry = e('u1', '2026-07-08', { workoutParts: ['arms'], steps: 12345, weight: 90, updatedAt: 9 });
  const line = feedLine(entry);
  assert.ok(line.includes('12,345'));
  assert.ok(/scale/i.test(line));
});

test('feedLine falls back when the entry is empty', () => {
  assert.ok(feedLine(e('u1', '2026-07-08')).length > 0);
});

test('stepsComment: sole stepper is carrying the team', () => {
  const entries = [e('u2', '2026-07-08', { steps: 9000 })];
  const c = stepsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex'));
  assert.ok(/carry|walking|legs/i.test(c));
});

test('stepsComment: exactly 10k gets side-eye when several have stepped', () => {
  const entries = [
    e('u2', '2026-07-08', { steps: 10000 }),
    e('u1', '2026-07-08', { steps: 4000 })
  ];
  const c = stepsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex'));
  assert.ok(c.includes('10'));
});

test('stepsComment: null when nobody has stepped', () => {
  assert.equal(stepsComment([], users, '2026-07-06', '2026-07-09'), null);
});

test('workoutsComment: stretching-only bloke gets sent to the squat rack', () => {
  const entries = [
    e('u1', '2026-07-07', { workoutParts: ['stretching'] }),
    e('u1', '2026-07-08', { workoutParts: ['stretching'] }),
    e('u2', '2026-07-08', { workoutParts: ['legs'] })
  ];
  const c = workoutsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Sam'));
  assert.ok(/squat rack|lift|barbell/i.test(c));
});

test('workoutsComment: slackers get named when others have trained', () => {
  const entries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  const c = workoutsComment(entries, users, '2026-07-06', '2026-07-09');
  assert.ok(c.includes('Alex') && c.includes('Bruce'));
});

test('workoutsComment: null when nobody has trained', () => {
  assert.equal(workoutsComment([], users, '2026-07-06', '2026-07-09'), null);
});

test('workoutsComment: a roast nickname is a full observational line, and never shares a card with the Olympic Torch', () => {
  const entries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  // Sam trained, so he can never be the zero-workout roast target — Alex/Bruce
  // are the slackers pool. Scan seeds for one where the nickname gate hits.
  let hit = null;
  for (let i = 0; i < 100 && !hit; i++) {
    const c = workoutsComment(entries, users, '2026-07-06', `seed-${i}`);
    const nick = NICKNAMES.zeroWorkouts.find(n => c.includes(n.name));
    if (nick) hit = { c, nick };
  }
  assert.ok(hit, 'expected at least one seed in 100 to trigger the nickname gate');
  // The punchline must be present — a bare tag like "Alex's a Sensor Light"
  // with no explanation is exactly what we must never emit.
  assert.ok(hit.c.includes(hit.nick.punchline), 'nickname line must include its punchline, not just the bare name');
  // One nickname per card: the compliment belongs to the everyone-trained
  // branch, not stapled onto a roast.
  assert.ok(!hit.c.includes(NICKNAMES.neverMisses[0].name),
    'a roast card must never also carry the Olympic Torch compliment');
  // The roast nickname must never land on Sam — he trained, he's not a slacker.
  assert.ok(!hit.c.includes(`Sam ${hit.nick.name}`));
});

test('workoutsComment: Olympic Torch praises the biggest trainer once the whole team is on the board', () => {
  const entries = users.map(u => e(u.id, '2026-07-07', { workoutParts: ['legs'] }));
  entries.push(e('u1', '2026-07-08', { workoutParts: ['chest'] })); // Sam trains most
  const torch = NICKNAMES.neverMisses[0];
  let hit = null;
  for (let i = 0; i < 100 && !hit; i++) {
    const c = workoutsComment(entries, users, '2026-07-06', `seed-${i}`);
    if (c.includes(torch.name)) hit = c;
  }
  assert.ok(hit, 'expected at least one seed in 100 to trigger the compliment gate');
  assert.ok(hit.includes(torch.punchline));
  assert.ok(hit.includes('Sam'), 'the torch goes to whoever trained the most days');
  // "an Olympic Torch", never "a Olympic Torch".
  assert.ok(!/\ba Olympic Torch\b/.test(hit));
});

test('workoutsComment: a streaking bloke (trained every day) never receives a roast nickname', () => {
  // Sam trains every day of the week — a clear streak. Alex never trains.
  const entries = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']
    .map(d => e('u1', d, { workoutParts: ['legs'] }));
  for (let i = 0; i < 50; i++) {
    const c = workoutsComment(entries, users, '2026-07-06', `streak-${i}`);
    // Whatever roast nickname (if any) appears, it must be attached to a
    // slacker (Alex/Bruce), never to Sam, and Sam must only ever show up
    // as the Olympic Torch compliment, never as a roast.
    for (const nick of NICKNAMES.zeroWorkouts) {
      if (c.includes(nick.name)) {
        assert.ok(!c.includes(`Sam ${nick.punchline}`));
      }
    }
  }
});

test('workoutsComment: coin-flip gate means some seeds produce no nickname at all', () => {
  const entries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  let sawNickname = false;
  let sawPlain = false;
  for (let i = 0; i < 100 && !(sawNickname && sawPlain); i++) {
    const c = workoutsComment(entries, users, '2026-07-06', `gate-${i}`);
    const hasAnyNickname = [...NICKNAMES.zeroWorkouts, NICKNAMES.neverMisses[0]].some(n => c.includes(n.name));
    if (hasAnyNickname) sawNickname = true; else sawPlain = true;
  }
  assert.ok(sawNickname, 'expected some seeds to trigger a nickname');
  assert.ok(sawPlain, 'expected some seeds to skip the nickname entirely');
});

test('weightComment: lone weigher praised, laggards behind-schedule, whole team weighed-in is quiet', () => {
  const one = [e('u1', '2026-07-08', { weight: 90 })];
  const c1 = weightComment(one, users, '2026-07-09');
  assert.ok(c1.includes('Sam'));

  const two = [...one, e('u2', '2026-07-08', { weight: 80 })];
  let hit = null;
  for (let i = 0; i < 100 && !hit; i++) {
    const c2 = weightComment(two, users, `seed-${i}`);
    const nick = NICKNAMES.trailingTeam.find(n => c2.includes(n.name));
    if (nick) hit = { c2, nick };
  }
  assert.ok(hit, 'expected at least one seed in 100 to trigger the trailing-team nickname gate');
  assert.ok(hit.c2.includes('Bruce'));
  assert.ok(hit.c2.includes(hit.nick.punchline), 'nickname line must include its punchline, not just the bare name');

  const three = [...two, e('u3', '2026-07-08', { weight: 70 })];
  assert.equal(weightComment(three, users, '2026-07-09'), null);
});

test('weightComment: nobody weighed in gets a "never weighed in" nickname roast with its punchline', () => {
  let hit = null;
  for (let i = 0; i < 100 && !hit; i++) {
    const c = weightComment([], users, `seed-${i}`);
    const nick = NICKNAMES.neverWeighed.find(n => c.includes(n.name));
    if (nick) hit = { c, nick };
  }
  assert.ok(hit, 'expected at least one seed in 100 to trigger the never-weighed nickname gate');
  assert.ok(hit.c.includes(hit.nick.punchline));
});

test('weightComment: coin-flip gate means some seeds skip the nickname (nobody-weighed case)', () => {
  let sawNickname = false;
  let sawPlain = false;
  for (let i = 0; i < 100 && !(sawNickname && sawPlain); i++) {
    const c = weightComment([], users, `gate-${i}`);
    const hasAnyNickname = NICKNAMES.neverWeighed.some(n => c.includes(n.name));
    if (hasAnyNickname) sawNickname = true; else sawPlain = true;
  }
  assert.ok(sawNickname, 'expected some seeds to trigger a nickname');
  assert.ok(sawPlain, 'expected some seeds to skip the nickname entirely');
});

test('STRETCH_ROASTS and TEN_K_LINES include full observational nickname lines (name + punchline, never a bare tag), reachable via feedLine', () => {
  for (const nick of NICKNAMES.stretchOnly) {
    const line = STRETCH_ROASTS.find(l => l.includes(nick.name));
    assert.ok(line, `expected a STRETCH_ROASTS line for ${nick.name}`);
    assert.ok(line.includes(nick.punchline), `expected the ${nick.name} line to include its punchline`);
  }
  for (const nick of NICKNAMES.tenK) {
    const line = TEN_K_LINES.find(l => l.includes(nick.name));
    assert.ok(line, `expected a TEN_K_LINES line for ${nick.name}`);
    assert.ok(line.includes(nick.punchline), `expected the ${nick.name} line to include its punchline`);
  }

  let stretchHit = false;
  let tenKHit = false;
  for (let i = 0; i < 50 && !(stretchHit && tenKHit); i++) {
    const stretchLine = feedLine(e('u1', '2026-07-08', { workoutParts: ['stretching'], updatedAt: i }));
    if (NICKNAMES.stretchOnly.some(n => stretchLine.includes(n.name))) stretchHit = true;
    const tenKLine = feedLine(e('u2', '2026-07-08', { steps: 10000, updatedAt: i }));
    if (NICKNAMES.tenK.some(n => tenKLine.includes(n.name))) tenKHit = true;
  }
  assert.ok(stretchHit, 'expected a stretch-only nickname line to be reachable');
  assert.ok(tenKHit, 'expected a 10k nickname line to be reachable');
});

test('nicknameLine always composes a punchline, never a bare tag, and varies its framing verb by seed', () => {
  const nick = NICKNAMES.stretchOnly[0];
  const line = nicknameLine(nick, 0, 'Dave');
  assert.ok(line.startsWith('Dave '));
  assert.ok(line.includes(nick.name));
  assert.ok(line.includes(nick.punchline));
  assert.notEqual(line, `Dave ${nick.name}`); // must never degrade to a bare tag

  const seenFramings = new Set();
  for (let idx = 0; idx < 6; idx++) {
    const l = nicknameLine(nick, idx, 'Dave');
    seenFramings.add(l.split(' - ')[0].trim());
  }
  assert.ok(seenFramings.size > 1, 'expected different framing indices to produce different framing verbs');
});

test('nickname-flavoured picks stay deterministic for the same inputs', () => {
  const workoutEntries = [e('u1', '2026-07-07', { workoutParts: ['legs'] })];
  assert.equal(
    workoutsComment(workoutEntries, users, '2026-07-06', '2026-07-09'),
    workoutsComment(workoutEntries, users, '2026-07-06', '2026-07-09')
  );
  assert.equal(
    weightComment([], users, '2026-07-09'),
    weightComment([], users, '2026-07-09')
  );
  const trailing = [e('u1', '2026-07-08', { weight: 90 }), e('u2', '2026-07-08', { weight: 80 })];
  assert.equal(
    weightComment(trailing, users, '2026-07-09'),
    weightComment(trailing, users, '2026-07-09')
  );
});

test('banterFresh accepts today/yesterday, rejects stale, future, or missing', () => {
  assert.equal(banterFresh({ date: '2026-07-10' }, '2026-07-10'), true);
  assert.equal(banterFresh({ date: '2026-07-09' }, '2026-07-10'), true);
  assert.equal(banterFresh({ date: '2026-07-08' }, '2026-07-10'), false);
  assert.equal(banterFresh({ date: '2026-07-11' }, '2026-07-10'), false);
  assert.equal(banterFresh(null, '2026-07-10'), false);
  assert.equal(banterFresh({}, '2026-07-10'), false);
});

test('weightAxisBounds pads to 10 kg multiples with breathing room', () => {
  assert.deepEqual(weightAxisBounds([95, 96]), { min: 80, max: 110 });
  assert.deepEqual(weightAxisBounds([92]), { min: 80, max: 110 });
  assert.deepEqual(weightAxisBounds([70, 120]), { min: 60, max: 130 });
  assert.deepEqual(weightAxisBounds([90]), { min: 80, max: 100 });
});

test('feedLine covers a challenge-only entry (never the "logged... something" fallback)', () => {
  const entry = e('u1', '2026-07-10', { dailyChallenge: true, updatedAt: 5 });
  const line = feedLine(entry);
  assert.ok(line.toLowerCase().includes('daily challenge'), line);
  assert.ok(!line.includes('logged... something'));
  assert.equal(feedLine(entry), line); // deterministic
});

test('feedLine appends a challenge suffix when the tick rides along with other logging', () => {
  const entry = e('u1', '2026-07-10', { workoutParts: ['legs'], dailyChallenge: true, updatedAt: 5 });
  const line = feedLine(entry);
  assert.ok(line.includes('legs'));
  assert.ok(line.toLowerCase().includes('challenge'), line);
});

test('CHALLENGE_QUIPS rotate deterministically and never contain an em-dash', () => {
  assert.ok(CHALLENGE_QUIPS.length >= 3);
  assert.equal(pickFrom(CHALLENGE_QUIPS, '2026-07-10'), pickFrom(CHALLENGE_QUIPS, '2026-07-10'));
  for (const q of CHALLENGE_QUIPS) assert.ok(!q.includes('—'), q);
});

// ---- Same-day grace + rest days ----

test('hasAnyLog: an empty day counts as nothing, any real field counts', () => {
  assert.equal(hasAnyLog(e('u1', '2026-07-13')), false);
  assert.equal(hasAnyLog(e('u1', '2026-07-13', { steps: 0 })), false); // zero steps is not a log
  assert.equal(hasAnyLog(e('u1', '2026-07-13', { steps: 4000 })), true);
  assert.equal(hasAnyLog(e('u1', '2026-07-13', { workoutParts: ['legs'] })), true);
  assert.equal(hasAnyLog(e('u1', '2026-07-13', { weight: 90 })), true);
  assert.equal(hasAnyLog(e('u1', '2026-07-13', { dailyChallenge: true })), true);
});

test('emptyDayStreak never counts today and stops at the last logged day', () => {
  const entries = [
    e('u1', '2026-07-13', { workoutParts: ['legs'] }),
    e('u1', '2026-07-16', { steps: 5000 })
  ];
  // today 07-16 (logged today): yesterday 07-15 empty, 07-14 empty, 07-13 logged => 2
  assert.equal(emptyDayStreak(entries, 'u1', '2026-07-16'), 2);
  // today 07-14: yesterday 07-13 logged => 0 (active), today 07-14 blank is graced
  assert.equal(emptyDayStreak(entries, 'u1', '2026-07-14'), 0);
  // today 07-13 (only-ever log is today): nothing behind it, today graced => walks back to the cap
  assert.ok(emptyDayStreak(entries, 'u1', '2026-07-13') >= 3);
});

test('restDayStatus classifies active / resting / fair game, with today always graced', () => {
  const entries = [e('u1', '2026-07-13', { steps: 5000 })];
  assert.deepEqual(restDayStatus(entries, 'u1', '2026-07-14'),
    { emptyDays: 0, active: true, resting: false, fairGame: false });
  const r2 = restDayStatus(entries, 'u1', '2026-07-16'); // 2 empty completed days
  assert.equal(r2.emptyDays, REST_GRACE_DAYS);
  assert.ok(r2.resting && !r2.fairGame);
  const r3 = restDayStatus(entries, 'u1', '2026-07-17'); // 3 empty completed days
  assert.equal(r3.emptyDays, 3);
  assert.ok(r3.fairGame && !r3.resting);
});

test('workoutsComment: same-day grace - nobody is a slacker on a day with no completed day behind it', () => {
  // Monday IS today; only Sam has trained (today). Alex/Bruce are blank today,
  // but today is graced so they must never be roasted as slackers.
  const monday = '2026-07-13';
  const entries = [e('u1', '2026-07-13', { workoutParts: ['legs'] })];
  for (let i = 0; i < 30; i++) {
    const c = workoutsComment(entries, users, monday, `seed-${i}`, '2026-07-13');
    assert.ok(!/Alex|Bruce/.test(c), `today-only week should not roast the blank blokes: ${c}`);
  }
});

test('workoutsComment: rest-day grace - a bloke on a legit 1-2 day rest is left alone', () => {
  const monday = '2026-07-13';
  const today = '2026-07-16'; // Thursday
  const entries = [
    e('u1', '2026-07-13', { workoutParts: ['legs'] }),
    e('u1', '2026-07-14', { workoutParts: ['chest'] }), // Sam trains most
    e('u2', '2026-07-13', { workoutParts: ['back'] }),  // Alex trained a completed day
    e('u3', '2026-07-14', { steps: 8000 })              // Bruce: logged, no workout, 1 empty day since
  ];
  for (let i = 0; i < 30; i++) {
    const c = workoutsComment(entries, users, monday, `seed-${i}`, today);
    assert.ok(!c.includes('Bruce'), `resting bloke should not be roasted: ${c}`);
  }
});

test('workoutsComment: a bloke AWOL 3+ completed days is fair game', () => {
  const monday = '2026-07-13';
  const today = '2026-07-17'; // Friday
  const entries = [
    e('u1', '2026-07-13', { workoutParts: ['legs'] }),
    e('u1', '2026-07-16', { workoutParts: ['chest'] })
    // Alex and Bruce: nothing all week => 3+ empty completed days
  ];
  let roasted = false;
  for (let i = 0; i < 60 && !roasted; i++) {
    const c = workoutsComment(entries, users, monday, `seed-${i}`, today);
    if (/Alex|Bruce/.test(c)) roasted = true;
  }
  assert.ok(roasted, 'expected the AWOL blokes to get called out on some seed');
});

test('stepsComment: same-day grace - a lone stepper on day one is encouraged, not used to roast the rest', () => {
  const monday = '2026-07-13';
  const entries = [e('u2', '2026-07-13', { steps: 6000 })]; // Alex, today = Monday
  for (let i = 0; i < 20; i++) {
    const c = stepsComment(entries, users, monday, `seed-${i}`, '2026-07-13');
    assert.ok(c.includes('Alex'));
    assert.ok(!/couch|pathetic/i.test(c), `no roast on the first day: ${c}`);
  }
  // Once a completed day exists, the sole-stepper roast is back in play.
  let sawRoast = false;
  for (let i = 0; i < 40 && !sawRoast; i++) {
    const c = stepsComment(entries, users, monday, `seed-${i}`, '2026-07-15');
    if (/couch|carrying|walking|forgotten/i.test(c)) sawRoast = true;
  }
  assert.ok(sawRoast, 'expected a sole-stepper roast once completed days exist');
});
