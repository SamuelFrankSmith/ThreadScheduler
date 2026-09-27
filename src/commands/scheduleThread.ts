import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkChannelAccess, SCHEDULABLE_CHANNEL_TYPES } from '../channels.js';
import { createSchedule } from '../db.js';
import { initialNextRun, parseDateTime, parseInterval } from '../time.js';
import { detailView, MESSAGE_MAX, TITLE_MAX } from '../ui/views.js';
import type { Command } from './types.js';

export const scheduleThread: Command = {
  data: new SlashCommandBuilder()
    .setName('schedule-thread')
    .setDescription('Schedule a message that opens a thread and tags its subscribers')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) =>
      o.setName('title').setDescription('Title (shown in bold, also the thread name)').setRequired(true).setMaxLength(TITLE_MAX),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Message body').setRequired(true).setMaxLength(MESSAGE_MAX),
    )
    .addStringOption((o) =>
      o.setName('datetime').setDescription('First send time: MM/dd HH:mm (24h, UTC)').setRequired(true).setMaxLength(11),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post in')
        .setRequired(true)
        .addChannelTypes(...SCHEDULABLE_CHANNEL_TYPES),
    )
    .addStringOption((o) =>
      o
        .setName('interval')
        .setDescription('Repeat interval, e.g. 1d, 6hr, 1y, or 18:30hr for daily at 18:30 UTC')
        .setMaxLength(40),
    ),

  async execute(interaction) {
    const title = interaction.options.getString('title', true).trim();
    const message = interaction.options.getString('message', true).trim();
    const datetimeInput = interaction.options.getString('datetime', true);
    const channel = interaction.options.getChannel('channel', true, SCHEDULABLE_CHANNEL_TYPES);
    const intervalInput = interaction.options.getString('interval')?.trim() || null;

    const errors: string[] = [];
    if (!title) errors.push('Title cannot be empty.');
    if (!message) errors.push('Message cannot be empty.');

    const startAt = parseDateTime(datetimeInput);
    if (!startAt.ok) errors.push(startAt.error);

    const interval = intervalInput ? parseInterval(intervalInput) : null;
    if (interval && !interval.ok) errors.push(interval.error);

    const accessError = await checkChannelAccess(interaction.guild, channel.id);
    if (accessError) errors.push(accessError);

    if (errors.length > 0 || !startAt.ok || (interval && !interval.ok)) {
      await interaction.reply({ content: `❌ ${errors.join('\n❌ ')}`, flags: MessageFlags.Ephemeral });
      return;
    }

    const schedule = createSchedule({
      guildId: interaction.guildId,
      channelId: channel.id,
      title,
      message,
      startAt: startAt.value,
      interval: intervalInput,
      nextRunAt: initialNextRun(startAt.value, interval?.value ?? null),
      createdBy: interaction.user.id,
    });

    const { content, embeds } = detailView(schedule, 0, '✅ Scheduled thread created.');
    await interaction.reply({ content, embeds, flags: MessageFlags.Ephemeral });
  },
};
