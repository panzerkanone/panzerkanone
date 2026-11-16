/**
 * The content the server plays, bundled into the Worker as text (wrangler.toml's rule for .yaml
 * files): the scenarios of scenarios.ts, their boards, the rules data and the unit file, by their
 * paths from the repository's root. tests/net/content.test.ts checks that every scenario of the
 * game's list and its board are here.
 */
import rules from '../../content/rulesets/v1.ruleset.yaml';
import units from '../../content/units/v1.units.yaml';
import holtargard from '../../content/scenarios/holtargard_1943_trees.scenario.yaml';
import marnov from '../../content/scenarios/marnov_road_1943.scenario.yaml';
import keliach from '../../content/scenarios/keliach_bridges_1943.scenario.yaml';
import coast from '../../content/scenarios/coast_road_1943.scenario.yaml';
import ravayn from '../../content/scenarios/ravayn_woods_1943.scenario.yaml';
import galaost from '../../content/scenarios/galaost_patrol_1943.scenario.yaml';
import keliachIce from '../../content/scenarios/keliach_ice_1944.scenario.yaml';
import longLake from '../../content/scenarios/long_lake_1944.scenario.yaml';
import doviel from '../../content/scenarios/doviel_heights_1943.scenario.yaml';
import graviel from '../../content/scenarios/graviel_lakes_1943.scenario.yaml';
import hesorin from '../../content/scenarios/hesorin_bridgehead_1943.scenario.yaml';
import velost from '../../content/scenarios/velost_counterstroke_1943.scenario.yaml';
import testStandardTrees from '../../assets/maps/test_standard_trees.map.yaml';
import openSteppe from '../../assets/maps/open_steppe.map.yaml';
import farmlandRiver from '../../assets/maps/farmland_river.map.yaml';
import coastRoad from '../../assets/maps/coast_road.map.yaml';
import greatWoods from '../../assets/maps/great_woods.map.yaml';
import galaostHalf from '../../assets/maps/galaost_half.map.yaml';
import farmlandRiverWinter from '../../assets/maps/farmland_river_winter.map.yaml';
import longLakeWinter from '../../assets/maps/long_lake_winter.map.yaml';
import dovielHills from '../../assets/maps/doviel_hills.map.yaml';
import gravielLakes from '../../assets/maps/graviel_lakes.map.yaml';
import hesorinSteppe from '../../assets/maps/hesorin_steppe.map.yaml';
import velostWoods from '../../assets/maps/velost_woods.map.yaml';
import type { Texts } from './scenarios';

export const TEXTS: Texts = {
  'content/rulesets/v1.ruleset.yaml': rules,
  'content/units/v1.units.yaml': units,
  'content/scenarios/holtargard_1943_trees.scenario.yaml': holtargard,
  'content/scenarios/marnov_road_1943.scenario.yaml': marnov,
  'content/scenarios/keliach_bridges_1943.scenario.yaml': keliach,
  'content/scenarios/coast_road_1943.scenario.yaml': coast,
  'content/scenarios/ravayn_woods_1943.scenario.yaml': ravayn,
  'content/scenarios/galaost_patrol_1943.scenario.yaml': galaost,
  'content/scenarios/keliach_ice_1944.scenario.yaml': keliachIce,
  'content/scenarios/long_lake_1944.scenario.yaml': longLake,
  'content/scenarios/doviel_heights_1943.scenario.yaml': doviel,
  'content/scenarios/graviel_lakes_1943.scenario.yaml': graviel,
  'content/scenarios/hesorin_bridgehead_1943.scenario.yaml': hesorin,
  'content/scenarios/velost_counterstroke_1943.scenario.yaml': velost,
  'assets/maps/test_standard_trees.map.yaml': testStandardTrees,
  'assets/maps/open_steppe.map.yaml': openSteppe,
  'assets/maps/farmland_river.map.yaml': farmlandRiver,
  'assets/maps/coast_road.map.yaml': coastRoad,
  'assets/maps/great_woods.map.yaml': greatWoods,
  'assets/maps/galaost_half.map.yaml': galaostHalf,
  'assets/maps/farmland_river_winter.map.yaml': farmlandRiverWinter,
  'assets/maps/long_lake_winter.map.yaml': longLakeWinter,
  'assets/maps/doviel_hills.map.yaml': dovielHills,
  'assets/maps/graviel_lakes.map.yaml': gravielLakes,
  'assets/maps/hesorin_steppe.map.yaml': hesorinSteppe,
  'assets/maps/velost_woods.map.yaml': velostWoods,
};
