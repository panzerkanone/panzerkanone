/** Formation Impulse: what other code imports (README.md says how the code is laid out). */
export { loadImpulseMatch, namesOfScenario, rulesFileFor, unitsFileFor, mapFileFor } from './load';
export type { ImpulseContent, ImpulseLoadResult, ImpulseTexts, TextFile } from './load';
export { ImpulseRuleset, IMPULSE_REJECTION_CODES, outcomeKey, serialise } from './rules';
export type { ImpulseRulesetType, ImpulseSetup, UnitInfo, FormationInfo } from './rules';
export { checkRulesData, parseRulesData, terrainOf, RULES_FORMAT } from './data';
export type { RulesData } from './data';
export { checkUnitFile, parseUnitFile, UNITS_FORMAT } from './units';
export type { UnitFile, UnitType } from './units';
export { checkScenario, parseScenario, SCENARIO_FORMAT, zoneHexes } from './scenario';
export type { ScenarioData } from './scenario';
export { FireTable } from './table';
export * from './types';
