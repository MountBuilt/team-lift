// Deterministic lock-screen payloads. Report-up and reply pings do not go
// through the copywriter: they fire off an event, not a model call.

export const PUSH_BODY_CLIP = 180;

export function clipPushBody(text, max = PUSH_BODY_CLIP) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function reportPushPayload(reportText) {
  return {
    title: 'Aiden posted',
    body: clipPushBody(reportText) || "This morning's report is in Coach chat."
  };
}

export function replyPushPayload(replyText) {
  return {
    title: 'Aiden replied',
    body: clipPushBody(replyText) || 'He answered you in the thread.'
  };
}

/** User ids who posted pending comments on a target Aiden just answered. */
export function replyPushUserIds(threadJobs, replies) {
  const ids = new Set();
  for (const job of threadJobs || []) {
    if (!replies?.[job.target]) continue;
    for (const m of job.newUser || []) {
      if (m.userId) ids.add(m.userId);
    }
  }
  return [...ids];
}
