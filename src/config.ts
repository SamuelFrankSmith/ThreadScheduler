import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  /** When set, commands are registered to this guild only (instant updates). */
  guildId: process.env.GUILD_ID?.trim() || undefined,
  dbPath: process.env.DB_PATH?.trim() || './data/bot.db',
};
