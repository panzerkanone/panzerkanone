/**
 * A campaign file (`format: campaign/1`, content/campaigns/<id>.campaign.yaml) and its check. The design is
 * docs/review/M7/campaign/design.md: a chain of battles for one side, in order, one force carried through them.
 *
 *   format: campaign/1
 *   id:          the file's name without .campaign.yaml
 *   title, dates, blurb:   the campaign's name, its months, and one or two sentences for the list
 *   side:        the side the player commands: a side id of every battle
 *   otherSide:   the id of the file of the same campaign from the other side, or none (the two name each other)
 *   picture:     the list's picture (assets/scenarioart/v1/)
 *   film:        { briefing, end }: the film loops shown behind the briefing and at the end, each an id or none
 *   narration:   { opening, battles: [id, ...], end: { victory, draw, defeat, broken } }, or none: the pieces said in
 *                the briefing room (assets/narration/v1/narration.json, by id): the opening with the campaign's own
 *                briefing, one for each battle in the battles' order when it is next, one for each way it can end
 *   briefing:    { sides: [{ side, name, mark, stakes }, { ... }], story }: both sides, the player's first
 *   force:       { name, formations: [{ id, name, units: [{ id, type, name }] }] }: the force at full strength,
 *                which is the force the campaign starts with. Each formation keeps rule 3.1 as a scenario's does
 *   battles:     [scenario id, ...]: in order, each a scenario at level campaign (engine/rulesets/impulse/scenario.ts)
 *                whose side `side` is the force at full strength: of each formation it takes, exactly the force's
 *                units, in order, with their ids and starting types, a rider's transport in its own formation;
 *                it may leave whole formations out. Its other side, objectives and ending are its own
 *   replacements: { earned: { decisive, victory, defeat, heavy }, kinds: [[type, ...], ...] }: the points earned
 *                after a battle by its result for the player; and what may fill a lost unit's place, its own type
 *                or another of its kind. Every type of the force is in one kind; a kind's types all ride or none
 *                does, and all carry or none does; every place of every battle takes every type of its kind
 *   scoring:     { points: { decisive, victory, defeat, heavy }, victory, draw, broken: [p, q] }: campaign points
 *                a battle by its result; the totals that win and draw the campaign after its last battle; and
 *                the share of full strength below which the force is broken while battles remain
 *
 * Every key is required and no other is allowed; nothing is defaulted. The results, for the player: decisive (the
 * enemy broke, or the player reached the winning lead), victory (the higher score at the last turn), defeat (the
 * lower score at the last turn), heavy (the player's side broke, or the enemy reached the winning lead).
 *
 * The check reads the battles' files and boards through a source (CampaignSource): the game gives it its bundled
 * files (content.ts), the tests and the tools the repository's.
 */
import { parse as parseText } from 'yaml';
import { compileBoard } from '../../../engine/core/board';
import { hexOf, parseMap } from '../../../engine/core/map';
import { Checker, ID_PATTERN } from '../../../engine/kernel/check';
import { terrainOf } from '../../../engine/rulesets/impulse/data';
import type { RulesData } from '../../../engine/rulesets/impulse/data';
import { CAMPAIGN_LEVEL, checkScenario, enterableHexes, scenarioNames, SIDE_MARKS } from '../../../engine/rulesets/impulse/scenario';
import type { ScenarioData, SideMark } from '../../../engine/rulesets/impulse/scenario';
import type { UnitFile, UnitType } from '../../../engine/rulesets/impulse/units';

export const CAMPAIGN_FORMAT = 'campaign/1';
/** The results of a battle for the player, best first. */
export const RESULTS = ['decisive', 'victory', 'defeat', 'heavy'] as const;
export type Result = (typeof RESULTS)[number];
/** What `otherSide`, a film and the narration say when there is none. */
export const NONE = 'none';
/** The ways a campaign can end, each with its own piece of narration (force.ts's verdicts). */
export const NARRATED_ENDS = ['victory', 'draw', 'defeat', 'broken'] as const;

/** The narration said in the briefing room: pieces of assets/narration/v1/narration.json, by id. */
export interface CampaignNarration {
  /** Said with the campaign's own briefing, before its first battle's piece. */
  readonly opening: string;
  /** One for each battle, in the battles' order: said when that battle is next. */
  readonly battles: readonly string[];
  /** One for each way the campaign can end. */
  readonly end: Readonly<Record<(typeof NARRATED_ENDS)[number], string>>;
}

const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CampaignUnit {
  readonly id: string;
  readonly type: string;
  readonly name: string;
}

export interface CampaignFormation {
  readonly id: string;
  readonly name: string;
  readonly units: readonly CampaignUnit[];
}

export interface CampaignSide {
  readonly side: string;
  readonly name: string;
  readonly mark: SideMark;
  readonly stakes: string;
}

export interface CampaignData {
  readonly format: typeof CAMPAIGN_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly dates: string;
  readonly blurb: string;
  readonly side: string;
  readonly otherSide: string;
  readonly picture: string;
  readonly film: { readonly briefing: string; readonly end: string };
  readonly narration: CampaignNarration | typeof NONE;
  readonly briefing: { readonly sides: readonly [CampaignSide, CampaignSide]; readonly story: string };
  readonly force: { readonly name: string; readonly formations: readonly CampaignFormation[] };
  readonly battles: readonly string[];
  readonly replacements: { readonly earned: Readonly<Record<Result, number>>; readonly kinds: readonly (readonly string[])[] };
  readonly scoring: {
    readonly points: Readonly<Record<Result, number>>;
    readonly victory: number;
    readonly draw: number;
    readonly broken: readonly [number, number];
  };
}

export interface TextFile {
  readonly file: string;
  readonly text: string;
}

/** One battle of a campaign, as checked. */
export interface CampaignBattle {
  /** Its scenario file's id (content/scenarios/<id>.scenario.yaml). */
  readonly id: string;
  /** The scenario as written: the force at full strength. */
  readonly scenario: TextFile;
  readonly data: ScenarioData;
  /** Its board. */
  readonly map: TextFile;
  /** The battle of the game's list it is (its `battle`). */
  readonly battle: string;
  /** From its briefing: its title and date. */
  readonly title: string;
  readonly date: string;
  readonly turns: number;
  /** The index of the campaign's side among the scenario's sides. */
  readonly mine: number;
  /** The force's formations it takes, in order. */
  readonly formations: readonly string[];
}

/** Where the check finds a battle's files. */
export interface CampaignSource {
  readonly rules: RulesData;
  readonly units: UnitFile;
  /** content/scenarios/<id>.scenario.yaml, or null when there is no such file. */
  scenario(id: string): TextFile | null;
  /** assets/maps/<id>.map.yaml, or null when there is no such file. */
  map(id: string): TextFile | null;
  /** The board of the battle of the game's list with this id (client/src/game/scenarios.ts), or null when it lists none. */
  listedBoard(battle: string): string | null;
}

export interface CampaignLoadResult {
  campaign: CampaignData | null;
  battles: CampaignBattle[];
  problems: string[];
}

/** The kind of a type in a campaign: its list in `replacements.kinds` (the type alone when it is in none). */
export function kindOf(c: CampaignData, type: string): readonly string[] {
  return c.replacements.kinds.find(k => k.includes(type)) ?? [type];
}

/** The force's units in order, each with its formation. */
export function forceUnits(c: CampaignData): { unit: CampaignUnit; formation: CampaignFormation }[] {
  return c.force.formations.flatMap(formation => formation.units.map(unit => ({ unit, formation })));
}

/** Check a parsed campaign against the files of its battles. */
export function checkCampaign(raw: unknown, file: string, src: CampaignSource): CampaignLoadResult {
  const c = new Checker(file);
  const fail = (): CampaignLoadResult => ({ campaign: null, battles: [], problems: c.problems });
  const top = c.record('', raw, ['format', 'id', 'title', 'dates', 'blurb', 'side', 'otherSide', 'picture', 'film', 'narration', 'briefing', 'force', 'battles', 'replacements', 'scoring']);
  if (!top) return fail();
  const f = (k: string): unknown => c.at(top, k);
  if (f('format') !== CAMPAIGN_FORMAT) c.add('format', `must be '${CAMPAIGN_FORMAT}', got ${JSON.stringify(f('format'))}`);
  c.str('id', f('id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
  for (const k of ['title', 'dates', 'blurb']) c.str(k, f(k));
  const side = c.str('side', f('side'), ID_PATTERN, 'a side id');
  c.str('otherSide', f('otherSide'), ID_PATTERN, `the id of a campaign file, or ${NONE}`);
  c.str('picture', f('picture'), ID_PATTERN, 'a picture id');
  const film = c.record('film', f('film'), ['briefing', 'end']);
  if (film) for (const k of ['briefing', 'end']) c.str(`film.${k}`, c.at(film, k), ID_PATTERN, `a film id, or ${NONE}`);
  // The narration: pieces by id (tests/campaign/narration.test.ts holds every id to assets/narration/v1/narration.json),
  // one for each battle, in order.
  if (f('narration') !== NONE) {
    const n = c.record('narration', f('narration'), ['opening', 'battles', 'end']);
    if (n) {
      const piece = `a narration piece's id (or narration: ${NONE})`;
      c.str('narration.opening', c.at(n, 'opening'), ID_PATTERN, piece);
      const told = c.list('narration.battles', c.at(n, 'battles'), 1, 20);
      told?.forEach((t, i) => c.str(`narration.battles[${i + 1}]`, t, ID_PATTERN, piece));
      const listed = f('battles');
      if (told && Array.isArray(listed) && told.length !== listed.length) c.add('narration.battles', `names ${told.length} pieces for ${listed.length} battles: one for each battle, in the battles' order`);
      const end = c.keyed('narration.end', c.at(n, 'end'), NARRATED_ENDS, 'way the campaign ends');
      if (end) for (const k of NARRATED_ENDS) c.str(`narration.end.${k}`, c.at(end, k), ID_PATTERN, piece);
    }
  }

  // The briefing: both sides, the player's first.
  const briefing = c.record('briefing', f('briefing'), ['sides', 'story']);
  const sideIds: string[] = [];
  if (briefing) {
    c.str('briefing.story', c.at(briefing, 'story'));
    c.list('briefing.sides', c.at(briefing, 'sides'), 2, 2)?.forEach((s, i) => {
      const place = `briefing.sides[${i + 1}]`;
      const v = c.record(place, s, ['side', 'name', 'mark', 'stakes']);
      if (!v) return;
      const id = c.str(`${place}.side`, c.at(v, 'side'), ID_PATTERN, 'a side id');
      if (id !== undefined) sideIds.push(id);
      c.str(`${place}.name`, c.at(v, 'name'));
      c.oneOf(`${place}.mark`, c.at(v, 'mark'), SIDE_MARKS, 'mark');
      c.str(`${place}.stakes`, c.at(v, 'stakes'));
    });
    if (side !== undefined && sideIds.length === 2) {
      if (sideIds[0] !== side) c.add('briefing.sides', `lists '${String(sideIds[0])}' first, but the player's side is '${side}': the player's side comes first`);
      if (sideIds[1] === sideIds[0]) c.add('briefing.sides', `names '${String(sideIds[0])}' twice`);
    }
  }

  // The force: formations of named units, each keeping 3.1.
  const typeOf = new Map<string, UnitType>(src.units.types.map(t => [t.id, t]));
  const typeIds = [...typeOf.keys()];
  const force = c.record('force', f('force'), ['name', 'formations']);
  /** The force's formations as read: id, and its units' ids and types in order. */
  const formations: { id: string; units: { id: string; type: string }[] }[] = [];
  const unitIds = new Set<string>();
  if (force) {
    c.str('force.name', c.at(force, 'name'));
    const seenFormations = new Set<string>();
    c.list('force.formations', c.at(force, 'formations'), 1, 20)?.forEach((fm, fi) => {
      const fp = `force.formations[${fi + 1}]`;
      const fv = c.record(fp, fm, ['id', 'name', 'units']);
      if (!fv) return;
      const fid = c.str(`${fp}.id`, c.at(fv, 'id'), UNIT_ID, 'letters, digits, _ and -');
      if (fid !== undefined) {
        if (seenFormations.has(fid)) c.add(`${fp}.id`, `'${fid}' is used twice`);
        seenFormations.add(fid);
      }
      c.str(`${fp}.name`, c.at(fv, 'name'));
      const units: { id: string; type: string }[] = [];
      let plain = 0;
      let transports = 0;
      let riders = 0;
      let transportSeen = false;
      c.list(`${fp}.units`, c.at(fv, 'units'), 1, 40)?.forEach((u, ui) => {
        const up = `${fp}.units[${ui + 1}]`;
        const uv = c.record(up, u, ['id', 'type', 'name']);
        if (!uv) return;
        const uid = c.str(`${up}.id`, c.at(uv, 'id'), UNIT_ID, 'letters, digits, _ and -');
        const tid = c.oneOf(`${up}.type`, c.at(uv, 'type'), typeIds, 'unit type');
        c.str(`${up}.name`, c.at(uv, 'name'));
        if (uid !== undefined) {
          if (unitIds.has(uid)) c.add(`${up}.id`, `'${uid}' is used twice`);
          unitIds.add(uid);
        }
        const t = tid !== undefined ? typeOf.get(tid) : undefined;
        if (t) {
          if (t.carries > 0) {
            transports++;
            transportSeen = true;
          } else {
            plain++;
            if (transportSeen) c.add(up, `a ${t.id} is listed after a transport: a formation lists its transports last (3.1)`);
          }
          if (t.rides) riders++;
        }
        if (uid !== undefined && tid !== undefined) units.push({ id: uid, type: tid });
      });
      if (plain < 2 || plain > 5) c.add(`${fp}.units`, `has ${plain} units that are not transports: a formation has two to five (3.1)`);
      if (transports > riders) c.add(`${fp}.units`, `has ${transports} transports but ${riders} units that can be carried: no more transports than that (3.1)`);
      if (fid !== undefined) formations.push({ id: fid, units });
    });
  }

  // Replacements: what each result earns, and the kinds.
  const replacements = c.record('replacements', f('replacements'), ['earned', 'kinds']);
  const kinds: string[][] = [];
  if (replacements) {
    const earned = c.keyed('replacements.earned', c.at(replacements, 'earned'), RESULTS, 'result');
    if (earned) for (const r of RESULTS) c.int(`replacements.earned.${r}`, c.at(earned, r), 0, 999);
    const inKind = new Map<string, number>();
    c.list('replacements.kinds', c.at(replacements, 'kinds'), 1, 20)?.forEach((k, ki) => {
      const kp = `replacements.kinds[${ki + 1}]`;
      const list = c.list(kp, k, 1, 20);
      if (!list) return;
      const kind: string[] = [];
      list.forEach((t, ti) => {
        const tid = c.oneOf(`${kp}[${ti + 1}]`, t, typeIds, 'unit type');
        if (tid === undefined) return;
        if (inKind.has(tid)) c.add(`${kp}[${ti + 1}]`, `${tid} is already in kind ${String((inKind.get(tid) as number) + 1)}: a type is in one kind`);
        inKind.set(tid, ki);
        kind.push(tid);
      });
      const types = kind.map(t => typeOf.get(t) as UnitType);
      if (types.some(t => t.rides !== (types[0] as UnitType).rides)) c.add(kp, 'mixes types that ride with types that do not: a place must take any type of its kind');
      if (types.some(t => t.carries > 0 !== (types[0] as UnitType).carries > 0)) c.add(kp, 'mixes transports with units that are not: a place must take any type of its kind');
      kinds.push(kind);
    });
    for (const fm of formations) for (const u of fm.units) if (!inKind.has(u.type)) c.add('replacements.kinds', `has no kind for ${u.type} (unit ${u.id} of the force): every type of the force is in one kind`);
  }

  // Scoring.
  const scoring = c.record('scoring', f('scoring'), ['points', 'victory', 'draw', 'broken']);
  const battleList = c.list('battles', f('battles'), 1, 20);
  if (scoring) {
    const points = c.keyed('scoring.points', c.at(scoring, 'points'), RESULTS, 'result');
    const p = RESULTS.map(r => (points ? c.int(`scoring.points.${r}`, c.at(points, r), 0, 9) : undefined));
    if (p.every(x => x !== undefined)) {
      for (let i = 1; i < p.length; i++) if ((p[i] as number) > (p[i - 1] as number)) c.add('scoring.points', `gives ${RESULTS[i]} more than ${RESULTS[i - 1]}: a better result is worth at least as much`);
    }
    const most = (p[0] ?? 0) * (battleList?.length ?? 0);
    const win = c.int('scoring.victory', c.at(scoring, 'victory'), 0, 999);
    const draw = c.int('scoring.draw', c.at(scoring, 'draw'), 0, 999);
    if (win !== undefined && win > most) c.add('scoring.victory', `is ${win}, more than the ${most} points the battles can give`);
    if (win !== undefined && draw !== undefined && draw > win) c.add('scoring.draw', `is ${draw}, more than victory (${win})`);
    const broken = c.list('scoring.broken', c.at(scoring, 'broken'), 2, 2);
    if (broken) {
      const bp = c.int('scoring.broken[1]', broken[0], 0, 99);
      const bq = c.int('scoring.broken[2]', broken[1], 1, 100);
      if (bp !== undefined && bq !== undefined && bp >= bq) c.add('scoring.broken', `must be a share below one, as [p, q] with p less than q, got [${bp}, ${bq}]`);
    }
  }

  // The battles: each a scenario at level campaign whose side `side` is the force at full strength.
  const battles: CampaignBattle[] = [];
  const seenBattles = new Set<string>();
  battleList?.forEach((b, bi) => {
    const bp = `battles[${bi + 1}]`;
    const id = c.str(bp, b, ID_PATTERN, 'a scenario file id');
    if (id === undefined) return;
    if (seenBattles.has(id)) c.add(bp, `'${id}' is listed twice`);
    seenBattles.add(id);
    const at = `${bp} (${id})`;
    const scenario = src.scenario(id);
    if (!scenario) return c.add(at, `there is no scenario file content/scenarios/${id}.scenario.yaml`);
    let sraw: unknown;
    try {
      sraw = parseText(scenario.text);
    } catch (err) {
      return c.add(at, `${scenario.file} is not readable as YAML: ${(err as Error).message.split('\n')[0] ?? ''}`);
    }
    const mapId = scenarioNames(sraw).map;
    const mapText = mapId === null ? null : src.map(mapId);
    if (mapId === null || !mapText) return c.add(at, `${scenario.file} names no board this game has (${String(mapId)})`);
    const parsed = parseMap(mapText.text);
    if (!parsed.map) return c.add(at, `${mapText.file} could not be read: ${parsed.problems.join('; ')}`);
    const map = parsed.map;
    const checked = checkScenario(sraw, scenario.file, src.rules, src.units, map);
    for (const p of checked.problems) c.add(at, p);
    const data = checked.scenario;
    if (!data) return;
    if (data.level !== CAMPAIGN_LEVEL || data.battle === undefined) return c.add(at, `${scenario.file} must say battle: <id> and level: ${CAMPAIGN_LEVEL}`);
    const listed = src.listedBoard(data.battle);
    if (listed === null) c.add(at, `is battle '${data.battle}', which the game's list does not have`);
    else if (listed !== map.id) c.add(at, `is played on '${map.id}', but the battle '${data.battle}' is played on '${listed}'`);
    if (data.freeDeployment) c.add(at, 'begins with a free deployment: a campaign battle sets the force up itself');
    if (!data.briefing) return c.add(at, 'has no briefing: a campaign battle is briefed before it starts');
    const mine = data.sides.findIndex(s => s.id === side);
    if (mine < 0) return c.add(at, `has no side '${String(side)}', the campaign's side`);
    const theirs = data.sides[1 - mine];
    if (sideIds[1] !== undefined && theirs && theirs.id !== sideIds[1]) c.add(at, `its other side is '${theirs.id}', but the campaign's briefing names '${sideIds[1]}'`);
    // The force at full strength: whole formations of it, in its order, exactly its units.
    const taken: string[] = [];
    let last = -1;
    const mySide = data.sides[mine];
    if (!mySide) return;
    for (const fm of mySide.formations) {
      const k = formations.findIndex(x => x.id === fm.id);
      const fat = `${at}: formation ${fm.id}`;
      if (k < 0) {
        c.add(fat, 'is no formation of the force');
        continue;
      }
      if (k <= last) c.add(fat, "is out of the force's order");
      last = k;
      taken.push(fm.id);
      const want = (formations[k] as { units: { id: string; type: string }[] }).units;
      const got = fm.units.map(u => `${u.id}:${u.type}`).join(' ');
      if (got !== want.map(u => `${u.id}:${u.type}`).join(' ')) c.add(fat, `must hold exactly the force's units in order (${want.map(u => `${u.id}:${u.type}`).join(' ')}), holds ${got}`);
      for (const u of fm.units) {
        if (u.carriedBy !== undefined && !fm.units.some(x => x.id === u.carriedBy)) c.add(`${fat}: unit ${u.id}`, `rides ${u.carriedBy}, which is not of its formation: a rider's transport is in its own formation`);
      }
    }
    if (taken.length === 0) c.add(at, 'takes no formation of the force');
    // Every place takes every type of its kind.
    const board = compileBoard(map, terrainOf(src.rules));
    const open = new Map<string, Uint8Array>();
    const enterable = (mover: string): Uint8Array | null => {
      if (!open.has(mover)) {
        const k = board.moverTypes.indexOf(mover);
        if (k < 0) return null;
        open.set(mover, enterableHexes(board, k));
      }
      return open.get(mover) ?? null;
    };
    for (const fm of mySide.formations) for (const u of fm.units) {
      if (u.hex === undefined) continue;
      const h = hexOf(map, u.hex);
      const kind = kinds.find(k => k.includes(u.type)) ?? [u.type];
      for (const t of kind) {
        const tt = typeOf.get(t);
        if (tt && enterable(tt.mover)?.[h] !== 1) c.add(`${at}: unit ${u.id}`, `starts in ${u.hex}, which a ${t} (of its kind) may not enter: every place takes every type of its kind`);
      }
    }
    const briefed = data.briefing;
    battles.push({ id, scenario, data, map: mapText, battle: data.battle, title: briefed.title, date: briefed.date, turns: data.ending.turns, mine, formations: taken });
  });
  if (!c.ok) return fail();
  return { campaign: raw as CampaignData, battles, problems: [] };
}

/** Read a campaign from its text and check it. */
export function parseCampaign(text: string, file: string, src: CampaignSource): CampaignLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { campaign: null, battles: [], problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkCampaign(raw, file, src);
}

/** The problems of two campaign files that name each other as the same campaign from its two sides; none when they agree. */
export function checkPair(a: { data: CampaignData; battles: readonly CampaignBattle[] }, b: { data: CampaignData; battles: readonly CampaignBattle[] }): string[] {
  const out: string[] = [];
  const say = (m: string): void => {
    out.push(`campaigns ${a.data.id} and ${b.data.id}: ${m}`);
  };
  if (a.data.otherSide !== b.data.id || b.data.otherSide !== a.data.id) say('must each name the other as otherSide');
  if (a.data.title !== b.data.title) say(`have different titles ('${a.data.title}', '${b.data.title}')`);
  if (a.data.dates !== b.data.dates) say(`have different dates ('${a.data.dates}', '${b.data.dates}')`);
  if (a.data.side !== b.data.briefing.sides[1].side || b.data.side !== a.data.briefing.sides[1].side) say("must be played from each other's other side");
  const boards = (x: readonly CampaignBattle[]): string => x.map(t => `${t.battle}@${t.map.file}`).join(' ');
  if (boards(a.battles) !== boards(b.battles)) say(`must fight the same battles on the same boards in the same order (${boards(a.battles)} | ${boards(b.battles)})`);
  return out;
}
