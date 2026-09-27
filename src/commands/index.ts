import { listThreads } from './listThreads.js';
import { scheduleThread } from './scheduleThread.js';
import { subscribe, unsubscribe } from './subscriptions.js';
import type { Command } from './types.js';

export const commands: Command[] = [scheduleThread, listThreads, subscribe, unsubscribe];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
