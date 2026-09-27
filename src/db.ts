import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Schedule {
  id: number;
  guildId: string;
  channelId: string;
  title: string;
  message: string;
  /** Initially configured send time, epoch ms (UTC). */
  startAt: number;
  /** Raw interval string as entered by the user, or null for a one-shot. */
  interval: string | null;
  /** Next time to send, epoch ms. Null once a one-shot has been sent. */
  nextRunAt: number | null;
  createdBy: string;
  createdAt: number;
}

export type NewSchedule = Omit<Schedule, 'id' | 'createdAt'>;
export type ScheduleUpdate = Pick<Schedule, 'channelId' | 'title' | 'message' | 'startAt' | 'interval' | 'nextRunAt'>;

interface ScheduleRow {
  id: number;
  guild_id: string;
  channel_id: string;
  title: string;
  message: string;
  start_at: number;
  interval: string | null;
  next_run_at: number | null;
  created_by: string;
  created_at: number;
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    title: row.title,
    message: row.message,
    startAt: row.start_at,
    interval: row.interval,
    nextRunAt: row.next_run_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

let db: DatabaseSync;

export function openDatabase(path: string): void {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT    NOT NULL,
      channel_id  TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      message     TEXT    NOT NULL,
      start_at    INTEGER NOT NULL,
      interval    TEXT,
      next_run_at INTEGER,
      created_by  TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_guild ON schedules(guild_id);

    CREATE TABLE IF NOT EXISTS subscriptions (
      schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      user_id     TEXT    NOT NULL,
      PRIMARY KEY (schedule_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
  `);
}

export function createSchedule(s: NewSchedule): Schedule {
  const createdAt = Date.now();
  const result = db
    .prepare(
      `INSERT INTO schedules (guild_id, channel_id, title, message, start_at, interval, next_run_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.guildId, s.channelId, s.title, s.message, s.startAt, s.interval, s.nextRunAt, s.createdBy, createdAt);
  return { ...s, id: Number(result.lastInsertRowid), createdAt };
}

export function getSchedule(id: number): Schedule | undefined {
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  return row ? toSchedule(row) : undefined;
}

export function listSchedules(guildId: string): Schedule[] {
  const rows = db
    .prepare('SELECT * FROM schedules WHERE guild_id = ? ORDER BY title COLLATE NOCASE, id')
    .all(guildId) as unknown as ScheduleRow[];
  return rows.map(toSchedule);
}

export function updateSchedule(id: number, u: ScheduleUpdate): void {
  db.prepare(
    `UPDATE schedules
     SET channel_id = ?, title = ?, message = ?, start_at = ?, interval = ?, next_run_at = ?
     WHERE id = ?`,
  ).run(u.channelId, u.title, u.message, u.startAt, u.interval, u.nextRunAt, id);
}

export function deleteSchedule(id: number): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

export function getDueSchedules(now: number): Schedule[] {
  const rows = db
    .prepare('SELECT * FROM schedules WHERE next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at')
    .all(now) as unknown as ScheduleRow[];
  return rows.map(toSchedule);
}

export function setNextRun(id: number, nextRunAt: number | null): void {
  db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
}

export function subscribe(scheduleId: number, userId: string): void {
  db.prepare('INSERT OR IGNORE INTO subscriptions (schedule_id, user_id) VALUES (?, ?)').run(scheduleId, userId);
}

export function unsubscribe(scheduleId: number, userId: string): void {
  db.prepare('DELETE FROM subscriptions WHERE schedule_id = ? AND user_id = ?').run(scheduleId, userId);
}

export function listSubscribers(scheduleId: number): string[] {
  const rows = db
    .prepare('SELECT user_id FROM subscriptions WHERE schedule_id = ? ORDER BY rowid')
    .all(scheduleId) as unknown as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function countSubscribers(scheduleId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE schedule_id = ?').get(scheduleId) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

export function listUserSubscriptions(guildId: string, userId: string): Schedule[] {
  const rows = db
    .prepare(
      `SELECT s.* FROM schedules s
       JOIN subscriptions sub ON sub.schedule_id = s.id
       WHERE s.guild_id = ? AND sub.user_id = ?
       ORDER BY s.title COLLATE NOCASE, s.id`,
    )
    .all(guildId, userId) as unknown as ScheduleRow[];
  return rows.map(toSchedule);
}
