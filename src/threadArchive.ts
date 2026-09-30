import { ThreadAutoArchiveDuration } from 'discord.js';

/** Discord's "Hide after inactivity" choices for a thread. */
export const HIDE_AFTER_OPTIONS = [
  { label: '1 hour', minutes: ThreadAutoArchiveDuration.OneHour },
  { label: '24 hours', minutes: ThreadAutoArchiveDuration.OneDay },
  { label: '3 days', minutes: ThreadAutoArchiveDuration.ThreeDays },
  { label: '1 week', minutes: ThreadAutoArchiveDuration.OneWeek },
] as const;

export function isHideAfterMinutes(value: number): value is ThreadAutoArchiveDuration {
  return HIDE_AFTER_OPTIONS.some((o) => o.minutes === value);
}

/** Label for a stored value; null means the channel's own default applies. */
export function formatHideAfter(minutes: number | null): string {
  return HIDE_AFTER_OPTIONS.find((o) => o.minutes === minutes)?.label ?? 'Channel default';
}
