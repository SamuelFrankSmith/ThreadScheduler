import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { checkChannelAccess, SCHEDULABLE_CHANNEL_TYPES } from '../channels.js';
import { countSubscribers, deleteSchedule, getSchedule, listSchedules, updateSchedule, type Schedule } from '../db.js';
import { initialNextRun, parseDateTime, parseInterval } from '../time.js';
import { ids, isEditField, parseCustomId, type EditField } from '../ui/customIds.js';
import { endEditSession, getEditSession, isDirty, startEditSession, type Draft } from '../ui/editSessions.js';
import {
  deleteConfirmView,
  detailView,
  editModal,
  editView,
  expiredView,
  listView,
  MESSAGE_MAX,
  TITLE_MAX,
  type View,
} from '../ui/views.js';
import type { Command } from './types.js';

export const listThreads: Command = {
  data: new SlashCommandBuilder()
    .setName('list-threads')
    .setDescription('View, edit, or delete scheduled threads')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    await interaction.reply({ ...buildList(interaction.guild, 0), flags: MessageFlags.Ephemeral });
  },
};

const NOT_FOUND = '⚠️ That scheduled thread no longer exists.';
const EXPIRED = '⚠️ This edit session has expired. Go back to the list and start editing again.';

function buildList(guild: Guild, page: number, notice?: string): View {
  return listView(listSchedules(guild.id), page, (id) => guild.channels.cache.get(id)?.name, notice);
}

function loadSchedule(guild: Guild, rawId: string | undefined): Schedule | undefined {
  const schedule = getSchedule(Number(rawId));
  return schedule && schedule.guildId === guild.id ? schedule : undefined;
}

/** Next run implied by a draft: unchanged unless the datetime or interval was edited. */
function nextRunForDraft(current: Schedule, original: Draft, draft: Draft): number | null {
  if (draft.startAt === original.startAt && draft.interval === original.interval) {
    return current.nextRunAt;
  }
  const interval = draft.interval ? parseInterval(draft.interval) : null;
  return initialNextRun(draft.startAt, interval?.ok ? interval.value : null, config.timeZone);
}

function buildEditView(schedule: Schedule, session: { original: Draft; draft: Draft }, notice?: string): View {
  return editView(
    schedule.id,
    session.draft,
    {
      nextRunAt: nextRunForDraft(schedule, session.original, session.draft),
      subscribers: countSubscribers(schedule.id),
    },
    isDirty(session.original, session.draft),
    notice,
  );
}

export async function handleListComponent(
  interaction: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
): Promise<void> {
  const { guild, user } = interaction;
  const { action, args } = parseCustomId(interaction.customId);

  switch (action) {
    case 'page':
      await interaction.update(buildList(guild, Number(args[0])));
      return;

    case 'back':
      if (args[0]) endEditSession(user.id, Number(args[0]));
      await interaction.update(buildList(guild, 0));
      return;

    case 'select': {
      const value = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
      const schedule = loadSchedule(guild, value);
      await interaction.update(
        schedule ? detailView(schedule, countSubscribers(schedule.id)) : buildList(guild, Number(args[0]), NOT_FOUND),
      );
      return;
    }
  }

  const schedule = loadSchedule(guild, args.at(-1));
  if (!schedule) {
    await interaction.update(buildList(guild, 0, NOT_FOUND));
    return;
  }

  switch (action) {
    case 'detail':
      await interaction.update(detailView(schedule, countSubscribers(schedule.id)));
      return;

    case 'delete':
      await interaction.update(deleteConfirmView(schedule, countSubscribers(schedule.id)));
      return;

    case 'delconfirm':
      deleteSchedule(schedule.id);
      endEditSession(user.id, schedule.id);
      await interaction.update(buildList(guild, 0, `🗑️ Deleted **${schedule.title}**.`));
      return;

    case 'edit': {
      startEditSession(user.id, schedule);
      await interaction.update(buildEditView(schedule, getEditSession(user.id, schedule.id)!));
      return;
    }

    case 'field': {
      const field = args[0];
      const session = getEditSession(user.id, schedule.id);
      if (!session) {
        await interaction.update(expiredView(EXPIRED));
        return;
      }
      if (!isEditField(field)) return;
      await interaction.showModal(editModal(field, schedule.id, session.draft));
      return;
    }

    case 'save': {
      const session = getEditSession(user.id, schedule.id);
      if (!session) {
        await interaction.update(expiredView(EXPIRED));
        return;
      }
      const { draft, original } = session;
      if (draft.channelId !== original.channelId) {
        const accessError = await checkChannelAccess(guild, draft.channelId);
        if (accessError) {
          await interaction.update(buildEditView(schedule, session, `❌ ${accessError}`));
          return;
        }
      }
      updateSchedule(schedule.id, { ...draft, nextRunAt: nextRunForDraft(schedule, original, draft) });
      endEditSession(user.id, schedule.id);
      const saved = getSchedule(schedule.id)!;
      await interaction.update(detailView(saved, countSubscribers(saved.id), '✅ Changes saved.'));
      return;
    }
  }
}

/** Validates a modal value and applies it to the draft. Returns an error message on failure. */
async function applyField(
  interaction: ModalSubmitInteraction<'cached'>,
  field: EditField,
  draft: Draft,
): Promise<string | null> {
  if (field === 'channel') {
    const channel = interaction.fields.getSelectedChannels(ids.modalInput, true, SCHEDULABLE_CHANNEL_TYPES).first();
    if (!channel) return 'Please select a channel.';
    const accessError = await checkChannelAccess(interaction.guild, channel.id);
    if (accessError) return accessError;
    draft.channelId = channel.id;
    return null;
  }

  const value = interaction.fields.getTextInputValue(ids.modalInput).trim();
  switch (field) {
    case 'title':
      if (!value) return 'Title cannot be empty.';
      draft.title = value.slice(0, TITLE_MAX);
      return null;
    case 'message':
      if (!value) return 'Message cannot be empty.';
      draft.message = value.slice(0, MESSAGE_MAX);
      return null;
    case 'datetime': {
      const parsed = parseDateTime(value, config.timeZone);
      if (!parsed.ok) return parsed.error;
      draft.startAt = parsed.value;
      return null;
    }
    case 'interval': {
      if (!value) {
        draft.interval = null;
        return null;
      }
      const parsed = parseInterval(value);
      if (!parsed.ok) return parsed.error;
      draft.interval = value;
      return null;
    }
  }
}

export async function handleListModal(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const { action, args } = parseCustomId(interaction.customId);
  const [field, rawId] = args;
  if (action !== 'modal' || !isEditField(field) || !interaction.isFromMessage()) return;

  const schedule = loadSchedule(interaction.guild, rawId);
  if (!schedule) {
    await interaction.update(buildList(interaction.guild, 0, NOT_FOUND));
    return;
  }
  const session = getEditSession(interaction.user.id, schedule.id);
  if (!session) {
    await interaction.update(expiredView(EXPIRED));
    return;
  }

  const error = await applyField(interaction, field, session.draft);
  await interaction.update(buildEditView(schedule, session, error ? `❌ ${error}` : `✏️ Updated ${field}.`));
}
