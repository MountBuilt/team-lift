// Topical storylines: real-world beats from the group chat that Aiden runs with
// for a few days and then forgets on his own.
//
// HOW TO ADD ONE
//
//   { id: 'swifty-wagyu', subject: 'Swifty', added: '2026-07-26',
//     note: "Swifty has been smashing wagyu steaks all week. Sledge the
//            contrast between the fancy feed and the effort on the board." }
//
// That is the whole job: paste the beat with today's date. It goes live on the
// next tick and expires itself DEFAULT_DAYS later. You never edit an end date.
//
//   id       short unique slug
//   subject  a bloke's display name EXACTLY as it appears in the users roster,
//            or 'team' for a group-wide beat
//   added    the local date you fed it in, 'YYYY-MM-DD'
//   note     plain-English brief of the topic and the angle to sledge
//   days     OPTIONAL, overrides DEFAULT_DAYS. Only reach for this when a beat
//            genuinely has legs; a joke that outlives the moment is what makes
//            the banter feel stale.
//   until    OPTIONAL escape hatch, an explicit inclusive end date. Prefer
//            `added` + `days`.
//
// WHY THE SHORT DEFAULT: the first two storylines carried hand-written `until`
// dates, nobody moved them, and Aiden was still doing wagyu and no-scales
// material a week later. Both had long stopped being funny. Three days is about
// as long as a group-chat bit survives.
//
// Keep this list SHORT. Two or three live at a time, tops. A storyline is a
// garnish, not the meal (see scripts/prompt/aiden.md).
import { addDays } from '../js/lib/dates.js';

/** A fed-in beat is funny for about this long. */
export const DEFAULT_DAYS = 3;

export const STORYLINES = [
  // Empty on purpose. The wagyu and no-scales beats were retired on 2026-07-26
  // after running for a week. Add the next one here when the boys hand you one.
];

/** Inclusive last-active date for a storyline, or null if it has no start. */
export function storylineUntil(storyline) {
  if (typeof storyline?.until === 'string') return storyline.until;
  if (typeof storyline?.added !== 'string') return null;
  const days = Number.isInteger(storyline.days) && storyline.days > 0
    ? storyline.days
    : DEFAULT_DAYS;
  return addDays(storyline.added, days - 1);
}

/** Storylines live on `today` (inclusive of both ends), never before `added`. */
export function activeStorylines(storylines, today) {
  return (storylines ?? []).filter(s => {
    const until = storylineUntil(s);
    if (!until || until < today) return false;
    if (typeof s.added === 'string' && s.added > today) return false;
    return true;
  });
}
