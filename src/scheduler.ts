import { escapeMarkdown, type Client } from 'discord.js';
import { getDueSchedules, listSubscribers, setNextRun, type Schedule } from './db.js';
import { computeNextRun, parseInterval } from './time.js';

const POLL_MS = 30_000;
const MAX_MESSAGE_LENGTH = 2000;
/** Discord rejects allowed_mentions.users lists longer than this. */
const MAX_MENTIONS_PER_MESSAGE = 100;

let running = false;

export function startScheduler(client: Client<true>): void {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const schedule of getDueSchedules(Date.now())) {
        await runSchedule(client, schedule);
      }
    } catch (err) {
      console.error('Scheduler tick failed:', err);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), POLL_MS);
}

function nextRunFor(schedule: Schedule, now: number): number | null {
  if (!schedule.interval) return null;
  const parsed = parseInterval(schedule.interval);
  if (!parsed.ok) {
    console.error(`Schedule ${schedule.id} has an invalid interval "${schedule.interval}"; disabling.`);
    return null;
  }
  return computeNextRun(schedule.startAt, parsed.value, now);
}

/** Groups mentions into messages that fit Discord's length and mention limits. */
export function chunkMentions(userIds: string[]): { content: string; users: string[] }[] {
  const chunks: { content: string; users: string[] }[] = [];
  let current = { content: '', users: [] as string[] };
  for (const id of userIds) {
    const mention = `<@${id}>`;
    const tooLong = current.content.length + 1 + mention.length > MAX_MESSAGE_LENGTH;
    if (current.users.length > 0 && (tooLong || current.users.length >= MAX_MENTIONS_PER_MESSAGE)) {
      chunks.push(current);
      current = { content: '', users: [] };
    }
    current.content = current.content ? `${current.content} ${mention}` : mention;
    current.users.push(id);
  }
  if (current.users.length > 0) chunks.push(current);
  return chunks;
}

async function runSchedule(client: Client<true>, schedule: Schedule): Promise<void> {
  // Advance first so a failure or crash mid-send never causes a repeat post every tick.
  setNextRun(schedule.id, nextRunFor(schedule, Date.now()));

  try {
    const channel = await client.channels.fetch(schedule.channelId);
    if (!channel?.isTextBased() || channel.isDMBased() || channel.isThread() || !('threads' in channel)) {
      throw new Error(`channel ${schedule.channelId} is not a text or announcement channel`);
    }

    const message = await channel.send({
      content: `**${escapeMarkdown(schedule.title)}**\n${schedule.message}`,
      allowedMentions: { parse: [] },
    });
    const thread = await message.startThread({ name: schedule.title.slice(0, 100) });

    const subscribers = listSubscribers(schedule.id);
    for (const { content, users } of chunkMentions(subscribers)) {
      await thread.send({ content, allowedMentions: { users } });
    }
    console.log(`Sent schedule ${schedule.id} "${schedule.title}" to ${schedule.channelId} (${subscribers.length} tagged).`);
  } catch (err) {
    console.error(`Failed to send schedule ${schedule.id} "${schedule.title}":`, err);
  }
}
