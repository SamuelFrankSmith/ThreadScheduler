import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { checkChannelAccess, SCHEDULABLE_CHANNEL_TYPES } from '../channels.js';
import { createSchedule } from '../db.js';
import { HIDE_AFTER_OPTIONS } from '../threadArchive.js';
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
      o.setName('datetime').setDescription(`First send time: MM/dd HH:mm (24h, ${config.timeZone})`).setRequired(true).setMaxLength(11),
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
        .setDescription('Repeat interval, e.g. 1d, 6hr, 1y, or 18:30hr for daily at 18:30')
        .setMaxLength(40),
    )
    .addIntegerOption((o) =>
      o
        .setName('hide-after-inactivity')
        .setDescription("When the thread hides after no activity (defaults to the channel's setting)")
        .addChoices(...HIDE_AFTER_OPTIONS.map((opt) => ({ name: opt.label, value: opt.minutes }))),
    ),

  async execute(interaction) {
    const title = interaction.options.getString('title', true).trim();
    const message = interaction.options.getString('message', true).trim();
    const datetimeInput = interaction.options.getString('datetime', true);
    const channel = interaction.options.getChannel('channel', true, SCHEDULABLE_CHANNEL_TYPES);
    const intervalInput = interaction.options.getString('interval')?.trim() || null;
    const hideAfterMinutes = interaction.options.getInteger('hide-after-inactivity');

    const errors: string[] = [];
    if (!title) errors.push('Title cannot be empty.');
    if (!message) errors.push('Message cannot be empty.');

    const startAt = parseDateTime(datetimeInput, config.timeZone);
    if (!startAt.ok) errors.push(startAt.error);

    const interval = intervalInput ? parseInterval(intervalInput) : null;
    if (interval && !interval.ok) errors.push(interval.error);

    const accessError = await checkChannelAccess(interaction.guild, channel.id, interaction.member);
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
      nextRunAt: initialNextRun(startAt.value, interval?.value ?? null, config.timeZone),
      hideAfterMinutes,
      createdBy: interaction.user.id,
    });

    const { content, embeds } = detailView(schedule, 0, '✅ Scheduled thread created.');
    await interaction.reply({ content, embeds, flags: MessageFlags.Ephemeral });
  },
};
