import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';

/** Channel types the bot can post in and start threads from. */
export const SCHEDULABLE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];

/** Returns an error message if the bot cannot run schedules in the channel, otherwise null. */
export async function checkChannelAccess(guild: Guild, channelId: string): Promise<string | null> {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    return 'That channel no longer exists or I cannot see it.';
  }
  if (!(SCHEDULABLE_CHANNEL_TYPES as readonly ChannelType[]).includes(channel.type)) {
    return `<#${channelId}> must be a text or announcement channel.`;
  }
  const me = await guild.members.fetchMe();
  const missing = channel.permissionsFor(me).missing(REQUIRED_PERMISSIONS);
  if (missing.length > 0) {
    return `I am missing these permissions in <#${channelId}>: ${missing.join(', ')}.`;
  }
  return null;
}
