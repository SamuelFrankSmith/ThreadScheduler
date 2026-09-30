import type { Schedule } from '../db.js';

/** The editable fields of a schedule, as held while a user is in edit mode. */
export interface Draft {
  channelId: string;
  title: string;
  message: string;
  startAt: number;
  interval: string | null;
  hideAfterMinutes: number | null;
}

interface Session {
  original: Draft;
  draft: Draft;
  expiresAt: number;
}

/** Matches Discord's 15-minute interaction token lifetime. */
const TTL_MS = 15 * 60_000;
const sessions = new Map<string, Session>();

const key = (userId: string, scheduleId: number) => `${userId}:${scheduleId}`;

function toDraft(s: Schedule): Draft {
  return {
    channelId: s.channelId,
    title: s.title,
    message: s.message,
    startAt: s.startAt,
    interval: s.interval,
    hideAfterMinutes: s.hideAfterMinutes,
  };
}

function prune(now: number): void {
  for (const [k, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(k);
  }
}

export function startEditSession(userId: string, schedule: Schedule): Draft {
  const now = Date.now();
  prune(now);
  const original = toDraft(schedule);
  const session = { original, draft: { ...original }, expiresAt: now + TTL_MS };
  sessions.set(key(userId, schedule.id), session);
  return session.draft;
}

/** Returns the live draft (mutate it directly) and refreshes its expiry, or undefined if expired. */
export function getEditSession(userId: string, scheduleId: number): { original: Draft; draft: Draft } | undefined {
  const now = Date.now();
  const session = sessions.get(key(userId, scheduleId));
  if (!session || session.expiresAt <= now) {
    sessions.delete(key(userId, scheduleId));
    return undefined;
  }
  session.expiresAt = now + TTL_MS;
  return session;
}

export function endEditSession(userId: string, scheduleId: number): void {
  sessions.delete(key(userId, scheduleId));
}

export function isDirty(original: Draft, draft: Draft): boolean {
  return (Object.keys(original) as (keyof Draft)[]).some((k) => original[k] !== draft[k]);
}
