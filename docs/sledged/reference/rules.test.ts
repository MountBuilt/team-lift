/**
 * Sledged Firestore security rules — test suite.
 *
 * Run: firebase emulators:exec --only firestore "vitest run rules"
 *
 * The 16 numbered NEGATIVE cases below are the contract described in
 * docs/sledged/03-architecture.md §5. CI fails if any of them passes.
 *
 * If one of these fails, the fix is almost never to loosen the rule. It is to
 * change the client to stop doing the thing. Loosening a rule to make a test go
 * green is how this project gets a cross-crew data leak.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

let env: RulesTestEnvironment;

const CREW_A = 'crewAAAAAAAAAAAAAAAA';
const CREW_B = 'crewBBBBBBBBBBBBBBBB';

// Two blokes in crew A, one in crew B, one in neither.
const alice = () => env.authenticatedContext('alice', { crews: [CREW_A] }).firestore();
const bob   = () => env.authenticatedContext('bob',   { crews: [CREW_A] }).firestore();
const carol = () => env.authenticatedContext('carol', { crews: [CREW_B] }).firestore();
const solo  = () => env.authenticatedContext('solo',  {}).firestore();          // no claim at all
const anon  = () => env.unauthenticatedContext().firestore();

const entry = (uid: string, date: string, crewIds: string[], extra = {}) => ({
  userId: uid,
  crewIds,
  displayName: uid,
  date,
  weightDelta: -0.4,
  hasWeight: true,
  steps: 8000,
  workoutParts: ['legs'],
  dailyChallenge: true,
  source: 'manual',
  reactions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const message = (uid: string, extra = {}) => ({
  kind: 'user',
  userId: uid,
  displayName: uid,
  text: 'carn the boys',
  deleted: false,
  moderation: 'pending',
  createdAt: new Date(),
  ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'sledged-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Seed through the admin context, which bypasses rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { displayName: 'Alice', colour: '#f00', entitlement: 'free', crews: [CREW_A] });
    await setDoc(doc(db, 'users/bob'),   { displayName: 'Bob',   colour: '#0f0', entitlement: 'free', crews: [CREW_A] });
    await setDoc(doc(db, 'users/alice/weights/2026-08-09'), { kg: 91.4, createdAt: new Date() });

    await setDoc(doc(db, `crews/${CREW_A}`), {
      name: 'Sunday Crew', code: 'ABC123', createdBy: 'alice',
      memberIds: ['alice', 'bob'], intensity: 'savage', challengeStart: '2026-08-03',
    });
    await setDoc(doc(db, `crews/${CREW_B}`), {
      name: 'Other Crew', code: 'XYZ789', createdBy: 'carol',
      memberIds: ['carol'], intensity: 'standard', challengeStart: '2026-08-03',
    });

    await setDoc(doc(db, 'entries/alice_2026-08-09'), entry('alice', '2026-08-09', [CREW_A]));
    await setDoc(doc(db, 'entries/carol_2026-08-09'), entry('carol', '2026-08-09', [CREW_B]));

    await setDoc(doc(db, `crews/${CREW_A}/threads/report`), { kind: 'report', updatedAt: new Date() });
    await setDoc(doc(db, `crews/${CREW_A}/threads/report/messages/m1`), message('bob', { moderation: 'clean' }));
    await setDoc(doc(db, `crews/${CREW_B}/threads/report`), { kind: 'report', updatedAt: new Date() });
    await setDoc(doc(db, `crews/${CREW_B}/threads/report/messages/m9`), message('carol', { moderation: 'clean' }));

    await setDoc(doc(db, `crews/${CREW_A}/feedLines/alice_2026-08-09`), {
      text: 'Back in the bitch mittens again.', targetUserId: 'alice', moderation: 'clean', createdAt: new Date(),
    });
    await setDoc(doc(db, `crews/${CREW_A}/notebook/current`), { text: 'Bob claims a bad back every Tuesday.', updatedAt: new Date() });
    await setDoc(doc(db, 'reports/r1'), { reporterUid: 'bob', targetType: 'message', targetPath: 'x', reason: 'abuse', status: 'open', createdAt: new Date() });
    await setDoc(doc(db, 'config/app'), { minBuild: 1, killSwitches: {} });
    await setDoc(doc(db, 'inviteCodes/ABC123'), { crewId: CREW_A, crewName: 'Sunday Crew', memberCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// THE 16 NEGATIVE CASES. Each must be DENIED.
// ---------------------------------------------------------------------------

describe('negative cases (the contract)', () => {
  it('1. member of crew A cannot read an entry belonging to crew B', async () => {
    await assertFails(getDoc(doc(alice(), 'entries/carol_2026-08-09')));
  });

  it('2. member of crew A cannot read crew B messages, feed lines or notebook', async () => {
    await assertFails(getDoc(doc(alice(), `crews/${CREW_B}/threads/report/messages/m9`)));
    await assertFails(getDocs(collection(alice(), `crews/${CREW_B}/feedLines`)));
    await assertFails(getDoc(doc(alice(), `crews/${CREW_B}/notebook/current`)));
    await assertFails(getDoc(doc(alice(), `crews/${CREW_B}`)));
  });

  it('3. a user cannot write an entry under someone else\'s uid', async () => {
    await assertFails(setDoc(doc(bob(), 'entries/alice_2026-08-10'), entry('alice', '2026-08-10', [CREW_A])));
  });

  it('4. entry id must match {uid}_{date}', async () => {
    await assertFails(setDoc(doc(alice(), 'entries/alice_wrong-date'), entry('alice', '2026-08-10', [CREW_A])));
    await assertFails(setDoc(doc(alice(), 'entries/nonsense'), entry('alice', '2026-08-10', [CREW_A])));
  });

  it('5. a user cannot grant themselves a paid entitlement', async () => {
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { entitlement: 'paid' }));
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { trialEndsAt: new Date(2099, 0, 1) }));
  });

  it('6. a user cannot add a crew id to their own user doc', async () => {
    await assertFails(updateDoc(doc(alice(), 'users/alice'), { crews: [CREW_A, CREW_B] }));
  });

  it('7. a user cannot forge a message from Aiden', async () => {
    await assertFails(setDoc(
      doc(alice(), `crews/${CREW_A}/threads/report/messages/forged`),
      message('alice', { kind: 'aiden', userId: null }),
    ));
  });

  it('8. a user cannot edit another user\'s message, or the text of their own', async () => {
    await assertFails(updateDoc(doc(alice(), `crews/${CREW_A}/threads/report/messages/m1`), { deleted: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `crews/${CREW_A}/threads/report/messages/mine`), message('alice', { moderation: 'clean' }));
    });
    await assertFails(updateDoc(doc(alice(), `crews/${CREW_A}/threads/report/messages/mine`), { text: 'rewritten' }));
  });

  it('9. a user cannot write a reaction under another user\'s key', async () => {
    await assertFails(updateDoc(doc(bob(), 'entries/alice_2026-08-09'), { 'reactions.alice': '🔥' }));
  });

  it('10. no client can delete anything', async () => {
    await assertFails(deleteDoc(doc(alice(), 'entries/alice_2026-08-09')));
    await assertFails(deleteDoc(doc(alice(), 'users/alice')));
    await assertFails(deleteDoc(doc(alice(), `crews/${CREW_A}`)));
    await assertFails(deleteDoc(doc(alice(), `crews/${CREW_A}/threads/report/messages/m1`)));
    await assertFails(deleteDoc(doc(alice(), 'users/alice/weights/2026-08-09')));
  });

  it('11. nobody can read the moderation queue', async () => {
    await assertFails(getDoc(doc(alice(), 'reports/r1')));
    await assertFails(getDocs(collection(alice(), 'reports')));
  });

  it('12. unauthenticated users can read nothing but public config', async () => {
    await assertFails(getDoc(doc(anon(), 'entries/alice_2026-08-09')));
    await assertFails(getDoc(doc(anon(), 'users/alice')));
    await assertFails(getDoc(doc(anon(), `crews/${CREW_A}`)));
  });

  it('13. a removed member (claim revoked) loses access immediately', async () => {
    const evicted = env.authenticatedContext('bob', {}).firestore();   // claim gone
    await assertFails(getDoc(doc(evicted, `crews/${CREW_A}`)));
    await assertFails(getDoc(doc(evicted, 'entries/alice_2026-08-09')));
  });

  it('14. a message over 160 characters is rejected', async () => {
    await assertFails(setDoc(
      doc(alice(), `crews/${CREW_A}/threads/report/messages/long`),
      message('alice', { text: 'x'.repeat(161) }),
    ));
  });

  it('15. a crewmate cannot read your raw bodyweight', async () => {
    // The one that protects the product's central promise. Bob is in Alice's
    // crew and still must not see a kg figure.
    await assertFails(getDoc(doc(bob(), 'users/alice/weights/2026-08-09')));
    await assertFails(getDocs(collection(bob(), 'users/alice/weights')));
  });

  it('16. an entry carrying a raw weight field is rejected outright', async () => {
    await assertFails(setDoc(
      doc(alice(), 'entries/alice_2026-08-11'),
      entry('alice', '2026-08-11', [CREW_A], { weightKg: 91.4 }),
    ));
    await assertFails(updateDoc(doc(alice(), 'entries/alice_2026-08-09'), { weightKg: 91.4 }));
  });
});

// ---------------------------------------------------------------------------
// Positive cases. Rules that deny everything pass every negative test.
// ---------------------------------------------------------------------------

describe('positive cases (the app has to work)', () => {
  it('logs an entry for yourself', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'entries/alice_2026-08-10'), entry('alice', '2026-08-10', [CREW_A])));
  });

  it('a solo user with no crew claim can still log', async () => {
    // Regression: reading a missing `crews` claim used to error the rule out and
    // deny a brand new user their very first entry, which is the one that
    // triggers Aiden's firstLog line.
    await assertSucceeds(setDoc(doc(solo(), 'entries/solo_2026-08-10'), entry('solo', '2026-08-10', [])));
  });

  it('reads a crewmate\'s entry and reacts to it under your own key', async () => {
    await assertSucceeds(getDoc(doc(bob(), 'entries/alice_2026-08-09')));
    await assertSucceeds(updateDoc(doc(bob(), 'entries/alice_2026-08-09'), { 'reactions.bob': '💀' }));
  });

  it('reads your own weight', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/weights/2026-08-09')));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/weights/2026-08-10'), { kg: 91.1, createdAt: new Date() }));
  });

  it('posts to the crew thread and bins your own message', async () => {
    await assertSucceeds(setDoc(doc(alice(), `crews/${CREW_A}/threads/report/messages/new1`), message('alice')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `crews/${CREW_A}/threads/report/messages/new1`), { moderation: 'clean' });
    });
    await assertSucceeds(updateDoc(doc(alice(), `crews/${CREW_A}/threads/report/messages/new1`), { deleted: true }));
  });

  it('creates a crew with yourself as the only member', async () => {
    await assertSucceeds(setDoc(doc(solo(), 'crews/newcrew'), {
      name: 'New Crew', code: 'QWE456', createdBy: 'solo',
      memberIds: ['solo'], intensity: 'savage', challengeStart: '2026-08-10',
    }));
  });

  it('lets the admin rename the crew but not change membership', async () => {
    await assertSucceeds(updateDoc(doc(alice(), `crews/${CREW_A}`), { name: 'Renamed', intensity: 'clean' }));
    await assertFails(updateDoc(doc(alice(), `crews/${CREW_A}`), { memberIds: ['alice', 'bob', 'carol'] }));
    // ...and a non-admin cannot rename it at all.
    await assertFails(updateDoc(doc(bob(), `crews/${CREW_A}`), { name: 'Bobs Crew' }));
  });

  it('files a report, and reads public config and invite codes without signing in', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'reports/r2'), {
      reporterUid: 'alice', targetType: 'message', targetPath: 'p', reason: 'abuse',
      status: 'open', createdAt: new Date(),
    }));
    await assertSucceeds(getDoc(doc(anon(), 'config/app')));
    await assertSucceeds(getDoc(doc(anon(), 'inviteCodes/ABC123')));
  });
});
