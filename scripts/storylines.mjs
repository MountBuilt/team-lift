// Topical storylines: real-world beats from the group chat that the banter
// runs with for a few days, then drops automatically once they expire.
//
// The owner edits this file by hand. Each entry:
//   id      short unique slug for the storyline
//   subject a bloke's display name EXACTLY as it appears in the users roster,
//           or 'team' for a group-wide beat
//   until   inclusive last-active local date, 'YYYY-MM-DD'. On dates after
//           this the storyline is dropped from the context and the dashboard
//           cards regenerate on the next hourly tick (see decide.mjs).
//   note    plain-English brief of the topic and how to sledge it, for the
//           copywriter to weave in where it fits and is funny.
//
// Keep this list SHORT. Two or three live storylines at a time, tops. A
// storyline is a garnish, not the whole meal - see the copywriter SKILL.md
// "Topical storylines" section for how hard to lean on them.
export const STORYLINES = [
  {
    id: 'swifty-wagyu',
    subject: 'Swifty',
    until: '2026-07-25',
    note: "Swifty has been smashing wagyu steaks hard all week. Sledge him for " +
      "eating like a king / going full carnivore while the training or the " +
      "numbers slip - all that marbled beef and the barbell's gathering dust, " +
      "steak knife's getting more reps than the dumbbells, that sort of thing. " +
      "Keep it about the contrast between the fancy feed and the effort on the board."
  },
  {
    id: 'jon-no-scales',
    subject: 'Jon',
    until: '2026-07-25',
    note: "Jon reckons he hasn't got a set of scales so he never weighs in. Give " +
      "him heaps: buy a set of scales, borrow the pub's, weigh himself at the " +
      "servo next to the trailers, stand on the bathroom scales at Harvey Norman, " +
      "use the ones in the meat section at Woolies. Play up that a grown man " +
      "genuinely has no way to weigh himself in 2026. Don't state anyone's actual kg."
  }
];

// Storylines still live on `today` (inclusive of the `until` date).
export function activeStorylines(storylines, today) {
  return storylines.filter(s => typeof s?.until === 'string' && s.until >= today);
}
