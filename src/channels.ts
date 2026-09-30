import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { config } from './config.js';

/** Channel types the bot can post in and start threads from. */
export const SCHEDULABLE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];

/** What a member must be able to do in a channel to make the bot post there on their behalf. */
const MEMBER_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

/**
 * Returns an error message if schedules cannot target the channel, otherwise null.
 *
 * Checks that the bot can post and start threads there, and (unless
 * ENFORCE_CHANNEL_PERMISSIONS is off) that `member` could post there themselves,
 * so the bot can't be used to bypass channel permissions.
 */
export async function checkChannelAccess(guild: Guild, channelId: string, member: GuildMember): Promise<string | null> {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    return 'That channel no longer exists or I cannot see it.';
  }
  if (!(SCHEDULABLE_CHANNEL_TYPES as readonly ChannelType[]).includes(channel.type)) {
    return `<#${channelId}> must be a text or announcement channel.`;
  }

  if (config.enforceChannelPermissions) {
    const memberMissing = channel.permissionsFor(member).missing(MEMBER_PERMISSIONS);
    if (memberMissing.length > 0) {
      return `You need these permissions in <#${channelId}> to schedule posts there: ${memberMissing.join(', ')}.`;
    }
  }

  const me = await guild.members.fetchMe();
  const botMissing = channel.permissionsFor(me).missing(BOT_PERMISSIONS);
  if (botMissing.length > 0) {
    return `I am missing these permissions in <#${channelId}>: ${botMissing.join(', ')}.`;
  }
  return null;
}
