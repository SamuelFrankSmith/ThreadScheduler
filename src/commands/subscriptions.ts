import {
  ActionRowBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { listSchedules, listUserSubscriptions, subscribe as addSub, unsubscribe as removeSub } from '../db.js';
import { ids } from '../ui/customIds.js';
import { PAGE_SIZE } from '../ui/views.js';
import type { Command } from './types.js';

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function selectMenu(customId: string, placeholder: string, schedules: { id: number; title: string }[]) {
  const shown = schedules.slice(0, PAGE_SIZE);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(shown.length)
      .addOptions(shown.map((s) => ({ label: truncate(s.title, 100), value: String(s.id) }))),
  );
}

const overflowNote = (count: number) =>
  count > PAGE_SIZE ? `\n-# Showing the first ${PAGE_SIZE} of ${count}. Run the command again afterwards to see more.` : '';

export const subscribe: Command = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Get tagged when a scheduled thread is posted')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const subscribed = new Set(listUserSubscriptions(interaction.guildId, interaction.user.id).map((s) => s.id));
    const available = listSchedules(interaction.guildId).filter((s) => !subscribed.has(s.id));
    if (available.length === 0) {
      await interaction.reply({
        content: subscribed.size > 0 ? 'You are already subscribed to every scheduled thread.' : 'There are no scheduled threads yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: `Select the scheduled threads to subscribe to.${overflowNote(available.length)}`,
      components: [selectMenu(ids.subscribe.select(), 'Choose scheduled threads', available)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const unsubscribe: Command = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('Stop being tagged when a scheduled thread is posted')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const subscribed = listUserSubscriptions(interaction.guildId, interaction.user.id);
    if (subscribed.length === 0) {
      await interaction.reply({ content: 'You are not subscribed to any scheduled threads.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      content: `Select the scheduled threads to unsubscribe from.${overflowNote(subscribed.length)}`,
      components: [selectMenu(ids.unsubscribe.select(), 'Choose scheduled threads', subscribed)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export async function handleSubscriptionSelect(
  interaction: StringSelectMenuInteraction<'cached'>,
  mode: 'subscribe' | 'unsubscribe',
): Promise<void> {
  // Re-check against the guild's current schedules in case any were deleted meanwhile.
  const byId = new Map(listSchedules(interaction.guildId).map((s) => [s.id, s]));
  const chosen = interaction.values.map(Number).flatMap((id) => byId.get(id) ?? []);

  for (const schedule of chosen) {
    if (mode === 'subscribe') addSub(schedule.id, interaction.user.id);
    else removeSub(schedule.id, interaction.user.id);
  }

  const titles = chosen.map((s) => `**${s.title}**`).join(', ');
  const content =
    chosen.length === 0
      ? '⚠️ Those scheduled threads no longer exist.'
      : mode === 'subscribe'
        ? `✅ Subscribed to ${titles}. You'll be tagged when they're posted.`
        : `✅ Unsubscribed from ${titles}.`;
  await interaction.update({ content, components: [] });
}
