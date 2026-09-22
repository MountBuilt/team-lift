// Season 2 (2026-09-22): a short named season whose score is days with
// anything logged. The stored config/challenge doc can lag a deploy; the
// bundled season is what the crew sees until a later season is written
// over it. Between seasons the board stays open. Logs after the end date
// still count toward life, just not toward a closed season.
//
// Aiden's copy roster is separate from the scoreboard. 10-12 empty
// completed days is one welcome-back dare. 13 or more and his name comes
// off the copy until he logs. The scoreboard can still show a zero.
import { hasAnyLog, restDayStatus } from './banter.js';
import { addDays, mondayOf, parseLocal, totalWeeks, weekNumber } from './dates.js';

export const BUNDLED_SEASON = {
  title: 'Show Up',
  startDate: '2026-09-21',
  endDate: '2026-10-18'
};

/** Empty completed days before a bloke is dared back, then benched. */
export const DARE_FROM = 10;
export const BENCH_FROM = 13;

const ROTATE = ['oneBloke', 'headtohead', 'question', 'callback'];

export const BEAT_NOTES = {
  welcome: 'First report of this season. Welcome them. One line on the game: anything logged counts (a workout, a walk, a swim, the scales), the snack is an optional streak, four weeks. Do not recap the layoff and do not name who was missing.',
  offweek: 'The season has just closed. One warm line. The board is still open and a log still counts. Do not read a final scoreboard and do not sledge the gap.',
  week: 'Monday. Tell one story from last week. A standings recap has failed.',
  oneBloke: 'Talk about one bloke from voice.inPlay. Everyone else can wait until tomorrow.',
  headtohead: 'Two blokes from voice.inPlay and one number they actually share. If you cannot find two, talk about one.',
  question: 'Ask one specific question to one bloke. No scoreboard.',
  callback: 'Use one line that appears in memory. If memory has nothing worth quoting, ask a question instead. Never invent a quote.',
  wait: 'The season has not started. Invite them. Do not judge a day that has not happened.'
};

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Which season the app and the tick should treat as current.
 * A stored season that is still running and starts on or after the bundled
 * one wins (that is how the next season gets written). Otherwise a bundled
 * season that has not ended covers a stale finished doc.
 */
export function resolveSeason(remote, today) {
  const remoteLive = Boolean(remote?.startDate && remote?.endDate && remote.endDate >= today);
  if (remoteLive && remote.startDate >= BUNDLED_SEASON.startDate) {
    return {
      title: remote.title || BUNDLED_SEASON.title,
      startDate: remote.startDate,
      endDate: remote.endDate
    };
  }
  if (BUNDLED_SEASON.endDate >= today) return { ...BUNDLED_SEASON };
  if (remote?.startDate && remote?.endDate) {
    return {
      title: remote.title || 'Team Lift',
      startDate: remote.startDate,
      endDate: remote.endDate
    };
  }
  return { ...BUNDLED_SEASON };
}

function daysLogged(entries, userId, from, through) {
  if (!from || !through || from > through) return 0;
  const days = new Set();
  for (const e of entries || []) {
    if (e.userId !== userId || e.date < from || e.date > through) continue;
    if (hasAnyLog(e)) days.add(e.date);
  }
  return days.size;
}

/** Phase, clock, and days-on-the-board for one season. */
export function seasonView(entries, users, challenge, today) {
  const start = challenge?.startDate || '';
  const end = challenge?.endDate || '';
  const phase = !start || !end
    ? 'live'
    : today < start ? 'before'
    : today > end ? 'between'
    : 'live';
  const through = phase === 'before' ? addDays(start, -1) : (today < end ? today : end);
  const members = (users || []).map(u => ({
    userId: u.id,
    name: u.name,
    days: daysLogged(entries, u.id, start, through)
  })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));

  let week = 0;
  let weeks = 0;
  let dayN = 0;
  let totalDays = 0;
  let daysLeft = 0;
  if (start && end) {
    totalDays = Math.round((parseLocal(end) - parseLocal(start)) / 86400000) + 1;
    weeks = totalWeeks(start, end);
    if (phase === 'live') {
      week = weekNumber(today, start);
      dayN = Math.round((parseLocal(today) - parseLocal(start)) / 86400000) + 1;
      daysLeft = totalDays - dayN;
    }
  }
  return {
    phase,
    title: challenge?.title || '',
    start,
    end,
    through,
    week,
    weeks,
    dayN,
    totalDays,
    daysLeft,
    members
  };
}

/** Lock-screen nags stop once a bloke is benched. A daily ping to a ghost gets the app deleted. */
export function pushAllowed(entries, userId, today) {
  return restDayStatus(entries || [], userId, today).emptyDays < BENCH_FROM;
}

/** Who Aiden may talk about today. Scoreboard zeros are not an invitation. */
export function voiceRoster(entries, users, today) {
  const inPlay = [];
  const dare = [];
  const benched = [];
  for (const u of users || []) {
    const status = restDayStatus(entries || [], u.id, today);
    const row = { userId: u.id, name: u.name, emptyDays: status.emptyDays };
    if (status.emptyDays >= BENCH_FROM) benched.push(row);
    else if (status.emptyDays >= DARE_FROM) dare.push({ ...row, dare: true });
    else inPlay.push({
      ...row,
      active: status.active,
      resting: status.resting,
      fairGame: status.fairGame
    });
  }
  return { inPlay, dare, benched };
}

/** Drop names Aiden is not allowed to sledge or recite. */
export function hideNames(names, voice) {
  const hidden = new Set(
    [...(voice?.dare || []), ...(voice?.benched || [])].map(x => x.name)
  );
  return (names || []).filter(n => !hidden.has(n));
}

/**
 * The one job for this morning. `lastReportDay` is the report already on
 * the board. Null means the caller does not know, so the welcome and the
 * off-week only fire on the first two mornings.
 */
export function reportBeat({ today, challenge, lastReportDay = null, lastReportText = '' }) {
  if (!challenge?.startDate || !challenge?.endDate) {
    return today === mondayOf(today) ? 'week' : ROTATE[hash(today) % ROTATE.length];
  }
  const phase = today < challenge.startDate
    ? 'before'
    : today > challenge.endDate ? 'between' : 'live';
  if (phase === 'before') return 'wait';
  if (phase === 'live') {
    const title = String(challenge.title || '').trim().toLowerCase();
    const alreadyWelcomed = title.length > 0
      && String(lastReportText || '').toLowerCase().includes(title);
    const openingWeek = today <= addDays(challenge.startDate, 6);
    const neverThisSeason = !lastReportDay || lastReportDay < challenge.startDate;
    // The first week stays a welcome until a report actually names the season.
    // Covers the morning after a canned report written before this voice shipped.
    if (!alreadyWelcomed && (neverThisSeason || openingWeek)) return 'welcome';
    if (today === mondayOf(today)) return 'week';
  }
  if (phase === 'between') {
    const firstOff = lastReportDay == null
      ? today <= addDays(challenge.endDate, 1)
      : lastReportDay <= challenge.endDate;
    if (firstOff) return 'offweek';
  }
  return ROTATE[hash(today) % ROTATE.length];
}
