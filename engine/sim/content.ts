/**
 * Loading a match's static content from text: a scenario, the ruleset data it
 * names and the map it names. The engine does no file reading; callers pass
 * the texts and the file names (relative to the repository root), which are
 * used in messages and written into records.
 *
 * Where the files are, by convention:
 *   ruleset data   content/rulesets/<id>.ruleset.yaml
 *   map            assets/maps/<id>.map.yaml
 */
import { parse as parseText } from 'yaml';
import { CompiledBoard, boardMismatch, compileBoard, mapHash, terrainHash } from '../core/board';
import { parseMap } from '../core/map';
import type { RecordContent } from '../kernel/record';
import { parseRulesetData, rulesetHash, terrainOf } from '../rulesets/reference/data';
import { parseScenario, scenarioHash, scenarioRefs } from '../rulesets/reference/scenario';
import { ReferenceRuleset } from '../rulesets/reference/rules';

export interface TextFile {
  readonly file: string;
  readonly text: string;
}

export function rulesetFileFor(id: string): string {
  return `content/rulesets/${id}.ruleset.yaml`;
}

export function mapFileFor(id: string): string {
  return `assets/maps/${id}.map.yaml`;
}

/** The ruleset id and map id a scenario's text names, to find those files. */
export function scenarioNames(text: string): { ruleset: string | null; map: string | null } {
  try {
    return scenarioRefs(parseText(text));
  } catch {
    return { ruleset: null, map: null };
  }
}

export interface MatchContent {
  readonly ruleset: ReferenceRuleset;
  readonly refs: { readonly ruleset: RecordContent; readonly scenario: RecordContent; readonly map: RecordContent };
}

export interface ContentLoadResult {
  content: MatchContent | null;
  problems: string[];
}

export interface RecordContentResult {
  content: MatchContent | null;
  /** Why the record cannot be replayed on these files: a content hash differs. Names the file and both hashes. */
  refusal: string | null;
  problems: string[];
}

/**
 * Load the content a record names and check that each file is the one the
 * record was played on (same id and content hash), before anything is replayed.
 */
export function loadRecordContent(
  record: { readonly ruleset: RecordContent; readonly scenario: RecordContent; readonly map: RecordContent },
  t: { scenario: TextFile; ruleset: TextFile; map: TextFile },
  board?: CompiledBoard,
): RecordContentResult {
  const none = (refusal: string | null, problems: string[]): RecordContentResult => ({ content: null, refusal, problems });
  const m = parseMap(t.map.text);
  if (!m.map) return none(null, m.problems.map(p => `${t.map.file}: ${p}`));
  const mh = mapHash(m.map);
  if (m.map.id !== record.map.id || mh !== record.map.hash) {
    return none(`map ${record.map.id}: the record was played on content hash ${record.map.hash}; ${t.map.file} is map ${m.map.id} with content hash ${mh}`, []);
  }
  const d = parseRulesetData(t.ruleset.text, t.ruleset.file);
  if (!d.data) return none(null, d.problems);
  const rh = rulesetHash(d.data);
  if (d.data.id !== record.ruleset.id || rh !== record.ruleset.hash) {
    return none(`ruleset ${record.ruleset.id}: the record was played on content hash ${record.ruleset.hash}; ${t.ruleset.file} is ruleset ${d.data.id} with content hash ${rh}`, []);
  }
  const loaded = loadMatchContent(t, board);
  if (!loaded.content) return none(null, loaded.problems);
  const sc = loaded.content.refs.scenario;
  if (sc.id !== record.scenario.id || sc.hash !== record.scenario.hash) {
    return none(`scenario ${record.scenario.id}: the record was played on content hash ${record.scenario.hash}; ${t.scenario.file} is scenario ${sc.id} with content hash ${sc.hash}`, []);
  }
  return { content: loaded.content, refusal: null, problems: [] };
}

/**
 * Check and compile a match's content. `board`, when given, is a board already
 * compiled from the same map and terrain data (to save compiling it again).
 * It is checked first: a board whose map id, map content hash or terrain
 * content hash is not this content's is refused (a problem naming both
 * hashes), never played on.
 */
export function loadMatchContent(t: { scenario: TextFile; ruleset: TextFile; map: TextFile }, board?: CompiledBoard): ContentLoadResult {
  const problems: string[] = [];
  const m = parseMap(t.map.text);
  for (const p of m.problems) problems.push(`${t.map.file}: ${p}`);
  const d = parseRulesetData(t.ruleset.text, t.ruleset.file);
  problems.push(...d.problems);
  if (!m.map || !d.data) return { content: null, problems };
  const s = parseScenario(t.scenario.text, t.scenario.file, d.data, m.map);
  problems.push(...s.problems);
  if (!s.scenario) return { content: null, problems };
  const hash = mapHash(m.map);
  const terrain = terrainOf(d.data);
  if (board) {
    const mismatch = boardMismatch(board, { mapId: m.map.id, mapHash: hash, terrainHash: terrainHash(terrain) });
    if (mismatch !== null) return { content: null, problems: [`${t.map.file} with ${t.ruleset.file}: refused ${mismatch}`] };
  }
  const compiled = board ?? compileBoard(m.map, terrain);
  const ruleset = new ReferenceRuleset({ data: d.data, scenario: s.scenario, map: m.map }, compiled);
  return {
    content: {
      ruleset,
      refs: {
        ruleset: { id: d.data.id, hash: rulesetHash(d.data), file: t.ruleset.file },
        scenario: { id: s.scenario.id, hash: scenarioHash(s.scenario), file: t.scenario.file },
        map: { id: m.map.id, hash, file: t.map.file },
      },
    },
    problems: [],
  };
}
