/// <reference types="vite/client" />
/**
 * The campaigns the game ships, read from content/campaigns/ and checked once, when first asked for (the
 * campaign screens and a campaign battle's page fetch this module; the title does not). Each campaign is checked
 * by format.ts against its battles' files and boards as bundled, and a pair (the same campaign from both sides)
 * against each other; a file that does not check is an error that names it and every problem: nothing is made up.
 *
 * The list's order: by title, the German side's file before the Soviet side's of the same campaign.
 */
import rulesText from '../../../content/rulesets/v1.ruleset.yaml?raw';
import unitsText from '../../../content/units/v1.units.yaml?raw';
import { parseRulesData } from '../../../engine/rulesets/impulse/data';
import { parseUnitFile } from '../../../engine/rulesets/impulse/units';
import type { UnitFile } from '../../../engine/rulesets/impulse/units';
import { SCENARIOS } from '../game/scenarios';
import { checkPair, NONE, parseCampaign } from './format';
import type { CampaignBattle, CampaignData, CampaignSource, TextFile } from './format';

const campaignFiles = import.meta.glob<string>('../../../content/campaigns/*.campaign.yaml', { eager: true, query: '?raw', import: 'default' });
const scenarioFiles = import.meta.glob<string>('../../../content/scenarios/*.scenario.yaml', { eager: true, query: '?raw', import: 'default' });
const mapFiles = import.meta.glob<string>('../../../assets/maps/*.map.yaml', { eager: true, query: '?raw', import: 'default' });

export interface LoadedCampaign {
  readonly data: CampaignData;
  readonly battles: readonly CampaignBattle[];
  readonly file: string;
}

function textOf(table: Record<string, string>, file: string): TextFile | null {
  const text = table[`../../../${file}`];
  return text === undefined ? null : { file, text };
}

/** The unit file every campaign's battles are played with. */
export const CAMPAIGN_UNITS: UnitFile = (() => {
  const u = parseUnitFile(unitsText, 'content/units/v1.units.yaml');
  if (!u.units) throw new Error(u.problems.join('\n'));
  return u.units;
})();

let loaded: readonly LoadedCampaign[] | null = null;

/** Every campaign, checked. */
export function campaigns(): readonly LoadedCampaign[] {
  if (loaded) return loaded;
  const rules = parseRulesData(rulesText, 'content/rulesets/v1.ruleset.yaml');
  if (!rules.data) throw new Error(rules.problems.join('\n'));
  const src: CampaignSource = {
    rules: rules.data,
    units: CAMPAIGN_UNITS,
    scenario: id => textOf(scenarioFiles, `content/scenarios/${id}.scenario.yaml`),
    map: id => textOf(mapFiles, `assets/maps/${id}.map.yaml`),
    listedBoard: battle => SCENARIOS.find(s => s.id === battle)?.map ?? null,
  };
  const out: LoadedCampaign[] = [];
  const problems: string[] = [];
  for (const [path, text] of Object.entries(campaignFiles)) {
    const file = path.replace('../../../', '');
    const r = parseCampaign(text, file, src);
    problems.push(...r.problems);
    if (r.campaign) {
      const id = file.replace(/^content\/campaigns\//, '').replace(/\.campaign\.yaml$/, '');
      if (r.campaign.id !== id) problems.push(`${file}: its id is '${r.campaign.id}', but its file is named for '${id}'`);
      out.push({ data: r.campaign, battles: r.battles, file });
    }
  }
  for (const a of out) {
    if (a.data.otherSide === NONE) continue;
    const b = out.find(x => x.data.id === a.data.otherSide);
    if (!b) problems.push(`${a.file}: otherSide names '${a.data.otherSide}', which is no campaign file`);
    else if (a.data.id < b.data.id) problems.push(...checkPair(a, b));
  }
  if (problems.length > 0) throw new Error(`campaigns:\n${problems.join('\n')}`);
  loaded = out.sort((a, b) => a.data.title.localeCompare(b.data.title) || (a.data.side === 'german' ? -1 : b.data.side === 'german' ? 1 : 0));
  return loaded;
}

/** A campaign by its file's id, or null. */
export function campaignById(id: string): LoadedCampaign | null {
  return campaigns().find(c => c.data.id === id) ?? null;
}
