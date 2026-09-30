import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { SCHEDULABLE_CHANNEL_TYPES } from '../channels.js';
import type { Schedule } from '../db.js';
import { describeInterval, discordTimestamp, formatDateTime, formatInput, parseInterval } from '../time.js';
import type { Draft } from './editSessions.js';
import { ids, type EditField } from './customIds.js';

export const PAGE_SIZE = 25;
export const TITLE_MAX = 100;
export const MESSAGE_MAX = 1800;

/** Payload usable for both `reply()` (with an ephemeral flag added) and `update()`. */
export interface View {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...components: MessageActionRowComponentBuilder[]): Row =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function formatInterval(interval: string | null): string {
  if (!interval) return 'None (one-time)';
  const parsed = parseInterval(interval);
  return parsed.ok ? `\`${interval}\` (${describeInterval(parsed.value, config.timeZone)})` : `\`${interval}\` (invalid)`;
}

function formatWhen(ms: number): string {
  return `${formatDateTime(ms, config.timeZone)}\n${discordTimestamp(ms)} (${discordTimestamp(ms, 'R')})`;
}

// ---------- List view ----------

export function listView(
  schedules: Schedule[],
  page: number,
  channelName: (id: string) => string | undefined,
  notice?: string,
): View {
  const pageCount = Math.max(1, Math.ceil(schedules.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const header = notice ? `${notice}\n\n` : '';

  if (schedules.length === 0) {
    return {
      content: `${header}There are no scheduled threads yet. Create one with \`/schedule-thread\`.`,
      embeds: [],
      components: [],
    };
  }

  const pageItems = schedules.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const select = new StringSelectMenuBuilder()
    .setCustomId(ids.list.select(current))
    .setPlaceholder('Select a scheduled thread')
    .addOptions(
      pageItems.map((s) => {
        const channel = channelName(s.channelId);
        const next = s.nextRunAt ? `next ${formatDateTime(s.nextRunAt, config.timeZone)}` : 'finished';
        return {
          label: truncate(s.title, 100),
          value: String(s.id),
          description: truncate(`${channel ? `#${channel}` : 'unknown channel'} · ${next}`, 100),
        };
      }),
    );

  const components: Row[] = [row(select)];
  if (pageCount > 1) {
    components.push(
      row(
        new ButtonBuilder()
          .setCustomId(ids.list.page(current - 1))
          .setLabel('◀ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current === 0),
        new ButtonBuilder()
          .setCustomId(ids.list.page(current + 1))
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(current >= pageCount - 1),
      ),
    );
  }

  const pageInfo = pageCount > 1 ? ` (page ${current + 1}/${pageCount})` : '';
  return {
    content: `${header}**Scheduled threads**${pageInfo} — select one to view it.`,
    embeds: [],
    components,
  };
}

// ---------- Detail / edit embeds ----------

function scheduleEmbed(
  fields: Draft,
  extra: { nextRunAt: number | null; subscribers: number },
  heading: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(truncate(`${heading}${fields.title}`, 256))
    .addFields(
      { name: 'Title', value: truncate(fields.title, 1024) },
      { name: 'Message', value: truncate(fields.message, 1024) },
      { name: 'Channel', value: `<#${fields.channelId}>`, inline: true },
      { name: 'Subscribers', value: String(extra.subscribers), inline: true },
      { name: 'Initial datetime', value: formatWhen(fields.startAt) },
      { name: 'Repeat interval', value: formatInterval(fields.interval) },
      { name: 'Next run', value: extra.nextRunAt ? formatWhen(extra.nextRunAt) : 'None (finished)' },
    );
}

export function detailView(schedule: Schedule, subscribers: number, notice?: string): View {
  return {
    content: notice ?? '',
    embeds: [scheduleEmbed(schedule, { nextRunAt: schedule.nextRunAt, subscribers }, '')],
    components: [
      row(
        new ButtonBuilder().setCustomId(ids.list.edit(schedule.id)).setLabel('Edit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ids.list.delete(schedule.id)).setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ids.list.back()).setLabel('Back to list').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function deleteConfirmView(schedule: Schedule, subscribers: number): View {
  const subs = subscribers > 0 ? ` Its ${subscribers} subscription(s) will also be removed.` : '';
  return {
    content: `Delete **${schedule.title}**? This cannot be undone.${subs}`,
    embeds: [scheduleEmbed(schedule, { nextRunAt: schedule.nextRunAt, subscribers }, '')],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(ids.list.deleteConfirm(schedule.id))
          .setLabel('Confirm delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ids.list.detail(schedule.id)).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function editView(
  scheduleId: number,
  draft: Draft,
  extra: { nextRunAt: number | null; subscribers: number },
  dirty: boolean,
  notice?: string,
): View {
  const embed = scheduleEmbed(draft, extra, 'Editing: ').setFooter({
    text: dirty ? 'You have unsaved changes. Press Save to apply them.' : 'No changes yet.',
  });
  const fieldButton = (field: EditField, label: string) =>
    new ButtonBuilder().setCustomId(ids.list.field(field, scheduleId)).setLabel(label).setStyle(ButtonStyle.Primary);

  return {
    content: notice ?? '',
    embeds: [embed],
    components: [
      row(
        fieldButton('title', 'Title'),
        fieldButton('message', 'Message'),
        fieldButton('channel', 'Channel'),
        fieldButton('datetime', 'Datetime'),
        fieldButton('interval', 'Interval'),
      ),
      row(
        new ButtonBuilder()
          .setCustomId(ids.list.save(scheduleId))
          .setLabel('Save changes')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!dirty),
        new ButtonBuilder().setCustomId(ids.list.back(scheduleId)).setLabel('Back to list').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function expiredView(notice: string): View {
  return {
    content: notice,
    embeds: [],
    components: [
      row(new ButtonBuilder().setCustomId(ids.list.back()).setLabel('Back to list').setStyle(ButtonStyle.Secondary)),
    ],
  };
}

// ---------- Edit modals ----------

function textModal(
  field: EditField,
  scheduleId: number,
  title: string,
  label: string,
  input: TextInputBuilder,
  description?: string,
): ModalBuilder {
  const labelBuilder = new LabelBuilder().setLabel(label).setTextInputComponent(input.setCustomId(ids.modalInput));
  if (description) labelBuilder.setDescription(description);
  return new ModalBuilder().setCustomId(ids.list.modal(field, scheduleId)).setTitle(title).addLabelComponents(labelBuilder);
}

export function editModal(field: EditField, scheduleId: number, draft: Draft): ModalBuilder {
  switch (field) {
    case 'title':
      return textModal(
        field,
        scheduleId,
        'Edit title',
        'Title',
        new TextInputBuilder().setStyle(TextInputStyle.Short).setMaxLength(TITLE_MAX).setRequired(true).setValue(draft.title),
      );
    case 'message':
      return textModal(
        field,
        scheduleId,
        'Edit message',
        'Message',
        new TextInputBuilder()
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MESSAGE_MAX)
          .setRequired(true)
          .setValue(draft.message),
      );
    case 'datetime':
      return textModal(
        field,
        scheduleId,
        'Edit datetime',
        'Datetime (MM/dd HH:mm, 24h)',
        new TextInputBuilder()
          .setStyle(TextInputStyle.Short)
          .setMaxLength(11)
          .setRequired(true)
          .setPlaceholder('03/14 18:30')
          .setValue(formatInput(draft.startAt, config.timeZone)),
        `Timezone: ${config.timeZone}`,
      );
    case 'interval': {
      const input = new TextInputBuilder()
        .setStyle(TextInputStyle.Short)
        .setMaxLength(40)
        .setRequired(false)
        .setPlaceholder('e.g. 1d, 6hr, 1y, 18:30hr');
      if (draft.interval) input.setValue(draft.interval);
      return textModal(
        field,
        scheduleId,
        'Edit repeat interval',
        'Repeat interval',
        input,
        `Leave empty to send only once. HH:mm means daily at that time (${config.timeZone}).`,
      );
    }
    case 'channel':
      return new ModalBuilder()
        .setCustomId(ids.list.modal(field, scheduleId))
        .setTitle('Edit destination channel')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Destination channel')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId(ids.modalInput)
                .setChannelTypes(...SCHEDULABLE_CHANNEL_TYPES)
                .setDefaultChannels(draft.channelId)
                .setMinValues(1)
                .setMaxValues(1),
            ),
        );
  }
}
