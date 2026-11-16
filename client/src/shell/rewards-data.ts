/**
 * The rewards data (content/rewards/rewards.yaml, with the game's other data), read and checked once, when first asked
 * for: by the rewards screen when it is first shown and by a battle's end (client/src/rewards/rewards-end.ts), never with
 * the title. A file that does not check is an error naming every problem.
 */
import { parse } from 'yaml';
import { parseRewards } from './rewards-rules';
import type { RewardsData } from './rewards-rules';

export const REWARDS_FILE = 'content/rewards/rewards.yaml';
const TEXT = import.meta.glob<string>('../../../content/rewards/rewards.yaml', { query: '?raw', import: 'default', eager: true });

let data: RewardsData | null = null;

export function rewardsData(): RewardsData {
  if (data) return data;
  const text = TEXT[`../../../${REWARDS_FILE}`];
  if (text === undefined) throw new Error(`${REWARDS_FILE} is not bundled`);
  data = parseRewards(parse(text) as unknown, REWARDS_FILE);
  return data;
}
