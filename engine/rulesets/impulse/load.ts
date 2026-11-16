/**
 * Building a match's ruleset from the four texts: a scenario, the rules data,
 * the unit file and the map (bar M2a ruling 18). The engine reads no file:
 * callers pass each text with its file name (relative to the repository
 * root), which is used in messages and in records.
 *
 *   const { content, problems } = loadImpulseMatch({ scenario, rules, units, map });
 *   content.ruleset   the ruleset (ImpulseRuleset)
 *   content.refs      { ruleset, scenario, map }: id, content hash and file, as a record pins them;
 *                     the ruleset's hash covers the rules data and the unit file together
 *
 * Every file is checked on load by its own format's check. A map that is not
 * the one the scenario pins (by id and content hash), or a unit file or rules
 * data that is not the one it names, is refused with a message that names the
 * file and the content hashes; nothing is played on it.
 *
 * Where the files are, by convention:
 *   rules data   content/rulesets/<id>.ruleset.yaml
 *   unit file    content/units/<id>.units.yaml
 *   map          assets/maps/<id>.map.yaml
 */
import { parse as parseText } from 'yaml';
import { CompiledBoard, mapHash } from '../../core/board';
import { contentHash } from '../../core/canonical';
import { parseMap } from '../../core/map';
import type { RecordContent } from '../../kernel/record';
import { parseRulesData } from './data';
import { ImpulseRuleset } from './rules';
import { checkScenario, scenarioNames } from './scenario';
import { moversOf, parseUnitFile } from './units';

export interface TextFile {
  readonly file: string;
  readonly text: string;
}

export interface ImpulseTexts {
  readonly scenario: TextFile;
  readonly rules: TextFile;
  readonly units: TextFile;
  readonly map: TextFile;
}

export interface ImpulseContent {
  readonly ruleset: ImpulseRuleset;
  readonly refs: { readonly ruleset: RecordContent; readonly scenario: RecordContent; readonly map: RecordContent };
}

export interface ImpulseLoadResult {
  content: ImpulseContent | null;
  problems: string[];
}

export function rulesFileFor(id: string): string {
  return `content/rulesets/${id}.ruleset.yaml`;
}

export function unitsFileFor(id: string): string {
  return `content/units/${id}.units.yaml`;
}

export function mapFileFor(id: string): string {
  return `assets/maps/${id}.map.yaml`;
}

/** The rules data, unit file and map a scenario's text names, to find those files. */
export function namesOfScenario(text: string): { ruleset: string | null; units: string | null; map: string | null } {
  try {
    return scenarioNames(parseText(text));
  } catch {
    return { ruleset: null, units: null, map: null };
  }
}

/**
 * Check the four texts and build the match's ruleset. `board`, when given, is
 * a board already compiled from the same map and terrain data (checked).
 */
export function loadImpulseMatch(t: ImpulseTexts, opts: { readonly board?: CompiledBoard } = {}): ImpulseLoadResult {
  const problems: string[] = [];
  const m = parseMap(t.map.text);
  for (const p of m.problems) problems.push(`${t.map.file}: ${p}`);
  const r = parseRulesData(t.rules.text, t.rules.file);
  problems.push(...r.problems);
  const u = parseUnitFile(t.units.text, t.units.file);
  problems.push(...u.problems);
  if (!m.map || !r.data || !u.units) return { content: null, problems };
  const map = m.map;
  const rules = r.data;
  const units = u.units;

  let raw: unknown;
  try {
    raw = parseText(t.scenario.text);
  } catch (err) {
    return { content: null, problems: [`${t.scenario.file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  // The pins, before anything else: a file that is not the one pinned is refused, naming it and the hashes.
  // (A scenario that pins nothing is refused by its own check, below.)
  const named = scenarioNames(raw);
  const pinned = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).map : undefined;
  const pinnedHash = typeof pinned === 'object' && pinned !== null ? (pinned as Record<string, unknown>).hash : undefined;
  const givenMap = mapHash(map);
  if (typeof named.map === 'string' && typeof pinnedHash === 'string' && (named.map !== map.id || pinnedHash !== givenMap)) {
    return {
      content: null,
      problems: [`${t.map.file}: refused: ${t.scenario.file} pins map ${String(named.map)} with content hash ${String(pinnedHash)}; ${t.map.file} is map ${map.id} with content hash ${givenMap}`],
    };
  }
  if (named.units !== null && named.units !== units.id) {
    return {
      content: null,
      problems: [`${t.units.file}: refused: ${t.scenario.file} names unit file ${String(named.units)}; ${t.units.file} is unit file ${units.id} with content hash ${contentHash(units)}`],
    };
  }
  if (named.ruleset !== null && named.ruleset !== rules.id) {
    return {
      content: null,
      problems: [`${t.rules.file}: refused: ${t.scenario.file} names rules data ${String(named.ruleset)}; ${t.rules.file} is rules data ${rules.id} with content hash ${contentHash(rules)}`],
    };
  }
  for (const { mover, place } of moversOf(units)) {
    if (!rules.moverTypes.includes(mover)) problems.push(`${t.units.file}: ${place}: unknown mover type "${mover}" (the rules data ${t.rules.file} knows: ${rules.moverTypes.join(', ')})`);
  }
  const s = checkScenario(raw, t.scenario.file, rules, units, map);
  problems.push(...s.problems);
  if (!s.scenario || problems.length > 0) return { content: null, problems };
  let ruleset: ImpulseRuleset;
  try {
    ruleset = new ImpulseRuleset({ rules, units, scenario: s.scenario, map, ...(opts.board ? { board: opts.board } : {}) });
  } catch (err) {
    return { content: null, problems: [`${t.scenario.file}: ${(err as Error).message}`] };
  }
  return {
    content: {
      ruleset,
      refs: {
        ruleset: { id: rules.id, hash: ruleset.content.hash, file: t.rules.file },
        scenario: { id: s.scenario.id, hash: contentHash(s.scenario), file: t.scenario.file },
        map: { id: map.id, hash: givenMap, file: t.map.file },
      },
    },
    problems: [],
  };
}
