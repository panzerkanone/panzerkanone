/**
 * The scenarios a game may be made on, and their content as a host needs it. No platform here:
 * the texts are handed in by path (the Worker bundles them, texts.ts; a test reads them from disk).
 *
 * A scenario is named by the id the game's own list gives it (client/src/game/scenarios.ts), and
 * is played as it is set up (not its free-deployment form), on the real rules and the roster's
 * units, as the game page plays it (client/src/game/start.ts). tests/net/content.test.ts keeps this
 * list, the bundled texts and the game's list in step, and checks that the content hashes the
 * Worker pins are the ones a page holds.
 */
import { loadImpulseMatch, mapFileFor, namesOfScenario } from '../../engine/rulesets/impulse/load';
import type { ImpulseContent } from '../../engine/rulesets/impulse/load';

/** Each scenario's id and the file it is played from. */
export const ONLINE_SCENARIOS: readonly { readonly id: string; readonly file: string }[] = [
  { id: 'holtargard', file: 'content/scenarios/holtargard_1943_trees.scenario.yaml' },
  { id: 'marnov', file: 'content/scenarios/marnov_road_1943.scenario.yaml' },
  { id: 'keliach', file: 'content/scenarios/keliach_bridges_1943.scenario.yaml' },
  { id: 'coast', file: 'content/scenarios/coast_road_1943.scenario.yaml' },
  { id: 'ravayn', file: 'content/scenarios/ravayn_woods_1943.scenario.yaml' },
  // A battle's own level (a Patrol for Hill 87): the game's other levels are not played online yet.
  { id: 'galaost', file: 'content/scenarios/galaost_patrol_1943.scenario.yaml' },
  { id: 'keliach-ice', file: 'content/scenarios/keliach_ice_1944.scenario.yaml' },
  { id: 'long-lake', file: 'content/scenarios/long_lake_1944.scenario.yaml' },
  { id: 'doviel', file: 'content/scenarios/doviel_heights_1943.scenario.yaml' },
  { id: 'graviel', file: 'content/scenarios/graviel_lakes_1943.scenario.yaml' },
  { id: 'hesorin', file: 'content/scenarios/hesorin_bridgehead_1943.scenario.yaml' },
  { id: 'velost', file: 'content/scenarios/velost_counterstroke_1943.scenario.yaml' },
];

export const RULES_FILE = 'content/rulesets/v1.ruleset.yaml';
export const UNITS_FILE = 'content/units/v1.units.yaml';

/** Texts by their path from the repository's root. */
export type Texts = Readonly<Record<string, string>>;

/** What loading a scenario's content came to. */
export type Loaded = { readonly ok: true; readonly content: ImpulseContent } | { readonly ok: false; readonly problem: string };

function textOf(texts: Texts, file: string): string | null {
  return Object.prototype.hasOwnProperty.call(texts, file) ? (texts[file] as string) : null;
}

/** The content of a scenario by its id: its ruleset and the three pins. */
export function loadScenario(id: string, texts: Texts): Loaded {
  const listed = ONLINE_SCENARIOS.find(s => s.id === id);
  if (!listed) return { ok: false, problem: `no scenario is called '${id}'` };
  const scenario = textOf(texts, listed.file);
  if (scenario === null) return { ok: false, problem: `${listed.file} is not bundled` };
  const mapId = namesOfScenario(scenario).map;
  if (mapId === null) return { ok: false, problem: `${listed.file} names no board` };
  const mapFile = mapFileFor(mapId);
  const map = textOf(texts, mapFile);
  const rules = textOf(texts, RULES_FILE);
  const units = textOf(texts, UNITS_FILE);
  if (map === null || rules === null || units === null) return { ok: false, problem: `the files of '${id}' are not all bundled` };
  const loaded = loadImpulseMatch({
    scenario: { file: listed.file, text: scenario },
    rules: { file: RULES_FILE, text: rules },
    units: { file: UNITS_FILE, text: units },
    map: { file: mapFile, text: map },
  });
  if (!loaded.content) return { ok: false, problem: loaded.problems.slice(0, 3).join('; ') };
  return { ok: true, content: loaded.content };
}

/** Each scenario's content, loaded once: a ruleset holds no game state, so every game on one scenario shares it. */
export class ScenarioShelf {
  readonly #texts: Texts;
  readonly #loaded = new Map<string, Loaded>();

  constructor(texts: Texts) {
    this.#texts = texts;
  }

  get(id: string): Loaded {
    let hit = this.#loaded.get(id);
    if (!hit) {
      hit = loadScenario(id, this.#texts);
      this.#loaded.set(id, hit);
    }
    return hit;
  }
}
