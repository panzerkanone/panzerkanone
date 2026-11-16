/// <reference types="vite/client" />
/**
 * Every battle the game ships, in one place, each with the levels it is played at.
 *
 * A battle is played at two or three of four levels (the owner, 2026-11-14): Patrol, Skirmish,
 * Battle and Offensive. Each level is a scenario of its own (content/scenarios/), with its own units
 * and starting places, objectives and ending, on the battle's one board. A scenario says which level
 * of which battle it is by two keys at its top, `battle: <id>` and `level: <level>` (the scenario
 * format's, engine/rulesets/impulse/scenario.ts); the levels of one battle share its title and its
 * board, and this module refuses a file that says otherwise.
 *
 * `SCENARIOS` is the list a page shows a player to choose from: one entry a battle, in the order they
 * are offered, each with its levels smallest first. What an entry says is read from the scenario
 * files (title, board, and each level's date, sides, turns and units), so the list cannot say anything
 * the game does not play; the battle's id, its picture and each level's blurb are written here.
 *
 * The same module gives the game what it needs to start one: `scenarioTexts(id, level)` is the level's
 * scenario text, the text of its free-deployment form when it has one, and the text of its board
 * (assets/maps/). `scenarioPicture(id)` is the address of a picture of the library
 * (assets/scenarioart/v1/), for whoever shows one.
 *
 * To add a level or a battle: write its file (with `battle` and `level`), put a new battle's board
 * under assets/maps/, and add a line to `LISTED`. tests/game/scenarios.test.ts then loads it as the
 * game does and checks its picture.
 */
import { parse as parseText } from 'yaml';
import rosterText from '../../../content/units/v1.units.yaml?raw';

/** The levels of battle, smallest first (the scenario format's `level`). */
export const LEVELS = ['patrol', 'skirmish', 'battle', 'offensive'] as const;
export type Level = (typeof LEVELS)[number];

/** A level's name, as a player reads it. */
export const LEVEL_NAMES: Readonly<Record<Level, string>> = { patrol: 'Patrol', skirmish: 'Skirmish', battle: 'Battle', offensive: 'Offensive' };

/** True for one of the four levels' names as an address writes them. */
export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

/** One level of a battle, as a list shows it. */
export interface LevelEntry {
  readonly level: Level;
  /** One or two plain sentences for a list. */
  readonly blurb: string;
  /** Month and year, from its file ("July 1943"). */
  readonly date: string;
  /** Its last turn, from its file. */
  readonly turns: number;
  /** The names of its two sides, the one that moves first first, from its file. */
  readonly sides: readonly [string, string];
  /** Each side in a word ("German"), in the same order, from its briefing. */
  readonly short: readonly [string, string];
  /** How many units each side has, transports not counted, in the same order. */
  readonly units: readonly [number, number];
}

/** A battle as a list shows it. */
export interface ScenarioEntry {
  /** Short and stable: the address names a battle by it (`scenario=<id>`). */
  readonly id: string;
  /** The battle's short name, from its files (every level has the same). */
  readonly title: string;
  /** The id of its board (assets/maps/<id>.map.yaml), the same for every level. */
  readonly map: string;
  /** The id of its picture in assets/scenarioart/v1/art.json. */
  readonly picture: string;
  /** Its levels, smallest first. */
  readonly levels: readonly LevelEntry[];
  /** The level played when the address names none: its Battle level, or else its smallest. */
  readonly level: Level;
}

export interface TextFile {
  readonly file: string;
  readonly text: string;
}

/** What the game reads to start one level of a battle. */
export interface ScenarioTexts {
  readonly entry: ScenarioEntry;
  /** The level played. */
  readonly level: LevelEntry;
  /** The level's scenario as it is set up. */
  readonly scenario: TextFile;
  /** The same scenario beginning with a free deployment, when there is such a form of it. */
  readonly free: TextFile | null;
  /** Its board. */
  readonly map: TextFile;
}

/** What is written here of one level; the rest is read from its file. */
interface ListedLevel {
  /** The scenario's file under content/scenarios/, without `.scenario.yaml`. */
  readonly file: string;
  /** Its free-deployment form, the same way, or null. */
  readonly free: string | null;
  readonly blurb: string;
}

/** What is written here of a battle. */
interface Listed {
  readonly id: string;
  readonly picture: string;
  /** Its levels, smallest first; each file says which level it is. */
  readonly levels: readonly ListedLevel[];
}

/** The id of the battle the game opens with when the address names none. */
export const OPENING_SCENARIO = 'holtargard';

const LISTED: readonly Listed[] = [
  {
    id: 'holtargard',
    picture: 'engraving-tank-riders',
    levels: [
      {
        file: 'holtargard_skirmish_1943',
        free: null,
        blurb: 'The advance guards of a German battle group and a Soviet tank brigade race for the crossroads town. Take the town and the hill above it before the main bodies arrive.',
      },
      {
        file: 'holtargard_1943_trees',
        free: 'holtargard_1943_trees_free',
        blurb: 'A German battle group and a Soviet tank brigade reach the same crossroads town on the same morning. Take the town, the hill above it and the wood beside the road, and hold them.',
      },
      {
        file: 'holtargard_offensive_1943',
        free: null,
        blurb: 'Both main bodies arrive: a German armored battle group attacks across the whole front, and a Soviet tank brigade meets it. Take the town, both hills, the wood and Pelarost.',
      },
    ],
  },
  {
    id: 'marnov',
    picture: 'engraving-wrecks',
    levels: [
      {
        file: 'marnov_road_skirmish_1943',
        free: null,
        blurb: 'The two columns\' advance guards meet on the open steppe road west of Marnov. The Germans have the longer guns; the Soviets have more tanks. Take Hill 161 first.',
      },
      {
        file: 'marnov_road_1943',
        free: null,
        blurb: 'Two columns meet on the open steppe road west of Marnov. The Germans have Tigers and the longer guns, and move first. The Soviets have more tanks and more men. Whoever holds Hill 161 holds the road.',
      },
    ],
  },
  {
    id: 'keliach',
    picture: 'engraving-gun-battery',
    levels: [
      {
        file: 'keliach_bridges_1943',
        free: null,
        blurb: 'A German armored battle group must take two bridges from a Soviet regiment dug in on the far bank. Tanks can cross only by the bridges, and guns on the hill are waiting for them.',
      },
      {
        file: 'keliach_bridges_offensive_1943',
        free: null,
        blurb: 'The great attack comes: two German tank columns and two grenadier battalions cross at both bridges against a reinforced Soviet regiment. Take the bridges, Keliach, the ridge and Nestgard.',
      },
    ],
  },
  {
    id: 'coast',
    picture: 'engraving-gun-team',
    levels: [
      {
        file: 'coast_road_skirmish_1943',
        free: null,
        blurb: 'The head of a Soviet tank column meets the first two posts of a German rearguard on the coast road. Take Sorestad and Daroel before the day ends.',
      },
      {
        file: 'coast_road_1943',
        free: null,
        blurb: 'A Soviet tank column races west along the coast road. A German rearguard with Tigers holds three harbor villages in its way. Take all three before the day ends.',
      },
    ],
  },
  {
    id: 'ravayn',
    picture: 'engraving-rain-march',
    levels: [
      {
        file: 'ravayn_woods_skirmish_1943',
        free: null,
        blurb: 'A German tank company with a Tiger platoon probes the road between two woods south of Temmere. Soviet riflemen wait in the trees on both sides, with a gun.',
      },
      {
        file: 'ravayn_woods_1943',
        free: null,
        blurb: 'German Tigers must drive down a road between two woods to the bridge at Ravayn. Soviet riflemen wait in the trees on both sides, close enough to attack a tank by hand.',
      },
    ],
  },
  {
    id: 'galaost',
    picture: 'engraving-long-column',
    levels: [
      {
        file: 'galaost_patrol_1943',
        free: null,
        blurb: 'A German patrol comes down the north road to find the bridges at Galaost. A Soviet rifle company holds the village, and Soviet tanks are behind the long hill.',
      },
      {
        file: 'galaost_skirmish_1943',
        free: null,
        blurb: 'The German advance guard comes to take the crossing at Galaost. A Soviet rifle company with a gun holds the village, and Soviet tanks are coming up behind the long hill.',
      },
    ],
  },
  {
    id: 'keliach-ice',
    picture: 'engraving-commanders-view',
    levels: [
      {
        file: 'keliach_ice_1944',
        free: null,
        blurb: 'Winter, and the river at Keliach is frozen hard. A Soviet rifle division crosses the ice anywhere it likes, with its tanks, to take Galowick and Hill 144 from a German battle group.',
      },
    ],
  },
  {
    id: 'long-lake',
    picture: 'engraving-winter-trench',
    levels: [
      {
        file: 'long_lake_1944',
        free: null,
        blurb: 'A German battle group and a Soviet tank brigade race through the snow for the villages at the south end of a frozen lake. Trucks keep to the roads; infantry can cross the ice.',
      },
    ],
  },
  {
    id: 'doviel',
    picture: 'engraving-factory',
    levels: [
      {
        file: 'doviel_heights_skirmish_1943',
        free: null,
        blurb: 'A Soviet forward detachment must cross an open valley under German anti-tank guns on the ridges. Take Doviel and the east ridge before the German main body arrives.',
      },
      {
        file: 'doviel_heights_1943',
        free: null,
        blurb: 'A Soviet tank brigade must force its way through the hills where three roads meet at Doviel. German anti-tank guns hold the heights on both sides. Take the village and both ridges.',
      },
    ],
  },
  {
    id: 'graviel',
    picture: 'engraving-ruined-town',
    levels: [
      {
        file: 'graviel_lakes_skirmish_1943',
        free: null,
        blurb: 'A German advance guard races Soviet riflemen for the wood between two lakes and the bridge into Graviel. Whoever holds them holds the way into the town.',
      },
      {
        file: 'graviel_lakes_1943',
        free: null,
        blurb: 'A German battle group counterattacks to retake Graviel. Two lakes split the ground, so the attack must come past them by the west road or the east bridge.',
      },
    ],
  },
  {
    id: 'hesorin',
    picture: 'engraving-pontoon-bridge',
    levels: [
      {
        file: 'hesorin_bridgehead_skirmish_1943',
        free: null,
        blurb: 'Soviet tanks come across the open steppe to Hesorin, where a small German rearguard holds the north end of the bridge. Take the village and the bridge.',
      },
      {
        file: 'hesorin_bridgehead_1943',
        free: null,
        blurb: 'A German battle group holds a bridgehead at Hesorin so the last columns can cross the river. A Soviet tank brigade comes across the open steppe to crush it.',
      },
    ],
  },
  {
    id: 'velost',
    picture: 'engraving-rail-yard',
    levels: [
      {
        file: 'velost_counterstroke_skirmish_1943',
        free: null,
        blurb: 'The first German tanks to arrive strike a Soviet tank battalion at Korenel. Destroy its tanks and take Korenel and Velost before the rest of the brigade joins it.',
      },
      {
        file: 'velost_counterstroke_1943',
        free: null,
        blurb: 'A Soviet tank brigade broke through and took Velost. A German armored battle group with Tigers strikes it before its infantry arrives. Take back Velost, its bridge and Korenel.',
      },
    ],
  },
];

const SCENARIO_DIR = 'content/scenarios/';
const MAP_DIR = 'assets/maps/';
const PICTURE_DIR = 'assets/scenarioart/v1/';

const scenarioFiles = import.meta.glob<string>('../../../content/scenarios/*.scenario.yaml', { eager: true, query: '?raw', import: 'default' });
const mapFiles = import.meta.glob<string>('../../../assets/maps/*.map.yaml', { eager: true, query: '?raw', import: 'default' });
const pictureFiles = import.meta.glob<string>('../../../assets/scenarioart/v1/*.webp', { eager: true, query: '?url', import: 'default' });

/** A file of one of the three folders, by its path from the repository's root. */
function textOf(table: Record<string, string>, file: string): TextFile {
  const text = table[`../../../${file}`];
  if (text === undefined) throw new Error(`scenarios: there is no file ${file}`);
  return { file, text };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The unit types that carry others (trucks, half-tracks, wagons): a level's count of units leaves them out. */
const TRANSPORTS: ReadonlySet<string> = (() => {
  const raw: unknown = parseText(rosterText);
  const types = isRecord(raw) ? raw['types'] : undefined;
  if (!Array.isArray(types)) throw new Error('scenarios: content/units/v1.units.yaml has no list of types');
  const out = new Set<string>();
  for (const t of types as unknown[]) {
    if (!isRecord(t) || typeof t['id'] !== 'string' || typeof t['carries'] !== 'number') throw new Error('scenarios: a unit type of content/units/v1.units.yaml has no id or no carries');
    if (t['carries'] > 0) out.add(t['id']);
  }
  return out;
})();

/** What one level's file says of itself. Anything missing there is an error that names the file: nothing is made up. */
interface ReadLevel {
  readonly battle: string;
  readonly title: string;
  readonly map: string;
  readonly entry: LevelEntry;
}

function readLevel(l: ListedLevel, scenario: TextFile): ReadLevel {
  const fail = (what: string): never => {
    throw new Error(`${scenario.file}: a listed scenario needs ${what}`);
  };
  const raw: unknown = parseText(scenario.text);
  if (!isRecord(raw)) return fail('to be a record');
  const battle = raw['battle'];
  const level = raw['level'];
  if (typeof battle !== 'string' || battle === '') return fail('battle: the id of the battle it is a level of');
  if (!isLevel(level)) return fail(`level: one of ${LEVELS.join(', ')}`);
  const briefing = raw['briefing'];
  if (!isRecord(briefing)) return fail('a briefing');
  const title = briefing['title'];
  const date = briefing['date'];
  if (typeof title !== 'string' || title === '') return fail('briefing.title');
  if (typeof date !== 'string' || date === '') return fail('briefing.date');
  const map = raw['map'];
  const mapId = isRecord(map) ? map['id'] : undefined;
  if (typeof mapId !== 'string' || mapId === '') return fail('map.id');
  const ending = raw['ending'];
  const turns = isRecord(ending) ? ending['turns'] : undefined;
  if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 1) return fail('ending.turns');
  const sides = raw['sides'];
  if (!Array.isArray(sides) || sides.length !== 2) return fail('two sides');
  const names = sides.map((s: unknown) => (isRecord(s) ? s['name'] : undefined));
  const [first, second] = names;
  if (typeof first !== 'string' || first === '' || typeof second !== 'string' || second === '') return fail('a name for each side');
  const units = sides.map((s: unknown) => {
    const formations = isRecord(s) ? s['formations'] : undefined;
    if (!Array.isArray(formations)) return fail('formations for each side');
    let n = 0;
    for (const f of formations as unknown[]) {
      const list = isRecord(f) ? f['units'] : undefined;
      if (!Array.isArray(list)) return fail('units in each formation');
      for (const u of list as unknown[]) if (isRecord(u) && typeof u['type'] === 'string' && !TRANSPORTS.has(u['type'])) n++;
    }
    return n;
  });
  const told = briefing['sides'];
  const short = Array.isArray(told) ? told.map((s: unknown) => (isRecord(s) ? s['short'] : undefined)) : [];
  const [a, b] = short;
  if (typeof a !== 'string' || a === '' || typeof b !== 'string' || b === '') return fail('briefing.sides with a short name for each side');
  return {
    battle,
    title,
    map: mapId,
    entry: { level, blurb: l.blurb, date, turns, sides: [first, second], short: [a, b], units: [units[0] as number, units[1] as number] },
  };
}

interface LoadedLevel {
  readonly entry: LevelEntry;
  readonly scenario: TextFile;
  readonly free: TextFile | null;
}

interface LoadedBattle {
  readonly entry: ScenarioEntry;
  readonly levels: readonly LoadedLevel[];
  readonly map: TextFile;
}

/** A battle read from its levels' files, which must agree on the battle, its title and its board. */
function loadBattle(l: Listed): LoadedBattle {
  if (l.levels.length === 0) throw new Error(`scenarios: the battle '${l.id}' has no level`);
  if (l.levels.length >= LEVELS.length) throw new Error(`scenarios: the battle '${l.id}' has all ${LEVELS.length} levels; a battle is played at two or three`);
  let title = '';
  let map = '';
  const levels = l.levels.map((ll, i): LoadedLevel => {
    const scenario = textOf(scenarioFiles, `${SCENARIO_DIR}${ll.file}.scenario.yaml`);
    const read = readLevel(ll, scenario);
    if (read.battle !== l.id) throw new Error(`${scenario.file}: listed as a level of '${l.id}', but its file says battle '${read.battle}'`);
    if (i === 0) {
      title = read.title;
      map = read.map;
    } else {
      if (read.title !== title) throw new Error(`${scenario.file}: its title '${read.title}' is not its battle's, '${title}'`);
      if (read.map !== map) throw new Error(`${scenario.file}: its board '${read.map}' is not its battle's, '${map}'`);
    }
    return { entry: read.entry, scenario, free: ll.free === null ? null : textOf(scenarioFiles, `${SCENARIO_DIR}${ll.free}.scenario.yaml`) };
  });
  for (let i = 1; i < levels.length; i++) {
    const was = LEVELS.indexOf((levels[i - 1] as LoadedLevel).entry.level);
    const now = LEVELS.indexOf((levels[i] as LoadedLevel).entry.level);
    if (now <= was) throw new Error(`scenarios: the levels of '${l.id}' must be listed smallest first, each once (${levels.map(x => x.entry.level).join(', ')})`);
  }
  const has = (lv: Level): boolean => levels.some(x => x.entry.level === lv);
  const entry: ScenarioEntry = {
    id: l.id,
    title,
    map,
    picture: l.picture,
    levels: levels.map(x => x.entry),
    level: has('battle') ? 'battle' : (levels[0] as LoadedLevel).entry.level,
  };
  return { entry, levels, map: textOf(mapFiles, `${MAP_DIR}${map}.map.yaml`) };
}

const loaded: readonly LoadedBattle[] = LISTED.map(loadBattle);

/** Every battle the game ships, in the order a list offers them. */
export const SCENARIOS: readonly ScenarioEntry[] = loaded.map(t => t.entry);

/**
 * What the game reads to start the battle with this id at this level. With no id (null), or an id the
 * game does not know, it is the opening battle; with no level, or one the battle is not played at,
 * the battle's own (`ScenarioEntry.level`): an old link still starts a game.
 */
export function scenarioTexts(id: string | null, level: string | null = null): ScenarioTexts {
  const found = loaded.find(t => t.entry.id === id) ?? loaded.find(t => t.entry.id === OPENING_SCENARIO);
  if (!found) throw new Error(`scenarios: the opening scenario '${OPENING_SCENARIO}' is not listed`);
  const at = found.levels.find(x => x.entry.level === level) ?? found.levels.find(x => x.entry.level === found.entry.level);
  if (!at) throw new Error(`scenarios: the battle '${found.entry.id}' has no level '${found.entry.level}'`);
  return { entry: found.entry, level: at.entry, scenario: at.scenario, free: at.free, map: found.map };
}

/** The address of a picture of the library by its id (assets/scenarioart/v1/<id>.webp), or null when the library has none by that id. */
export function scenarioPicture(id: string): string | null {
  return pictureFiles[`../../../${PICTURE_DIR}${id}.webp`] ?? null;
}
