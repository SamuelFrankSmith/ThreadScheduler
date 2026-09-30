import 'dotenv/config';
import { isValidTimeZone } from './time.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function timeZone(): string {
  const value = process.env.TZ?.trim() || 'UTC';
  if (!isValidTimeZone(value)) {
    throw new Error(`TZ "${value}" is not a valid IANA timezone (e.g. America/New_York, Europe/London, UTC)`);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  /** When set, commands are registered to this guild only (instant updates). */
  guildId: process.env.GUILD_ID?.trim() || undefined,
  dbPath: process.env.DB_PATH?.trim() || './data/bot.db',
  /** IANA timezone for entering, displaying, and repeating schedules. */
  timeZone: timeZone(),
};
