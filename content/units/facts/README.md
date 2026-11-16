# Unit facts, first roster (Eastern Front, 1943)

Historical facts from which the first unit values are to be derived by the formulas of
`docs/research/2026-11/research-history-data.md`, section 3.2. These files hold facts only: no game
value is computed here and no formula is applied. Gathered 11 November 2026.

## Read first: unverified entries

"Unverified" means not read at a source in this session. There are eight. Seven are gaps, recorded
with `value: null`, and one has a value:

| File | Fact | Status |
|---|---|---|
| `su_rifle_company.yaml` | `weapons.submachine_gun.designation` = PPSh-41 | The tables say only "submachine gun". PPSh-41 is the standard type, but no table names it |
| `t34_76_m1943.yaml` | `armour.turret_front.angle_from_vertical_deg` | Gap. The hexagonal turret's front angle was not found |
| `su76m.yaml` | `traits.ground_pressure_kg_cm2` | Gap |
| `zis3_battery.yaml` | `gun.published_effective_range_m` | Gap. No published direct-fire effective range found |
| `opel_blitz.yaml` | `troops_carried`, `tow_capacity` | Gap. Web-search summaries give 10 (or 12) troops, but no usable source |
| `opel_blitz.yaml` | `crew.total` | Gap (added 2026-11-11, transport pass). No source gives the truck's crew |
| `zis5_truck.yaml` | `crew.total` | Gap (added 2026-11-11, transport pass). No source gives the truck's crew or cab seats |

The Sd.Kfz. 251 plate angles, gaps until the transport pass, are now filled from the US Catalog of
Enemy Ordnance (1945); see "Transport facts" below.

Nothing was filled from memory.

## The roster's date, and which value a formula takes

The first roster is dated **early July 1943** (the lead's ruling, 2026-11-11). Where a fact depends on
the date, its `value` is the figure for that date: the Tiger I E with the HL 230 engine and before
the governor (700 PS, 45.4 km/h), the SU-76M battery of four, the Soviet rifle company as issued in
December 1942 (the amendment is dated 15 July 1943).

A formula always takes an entry's `value`. `alternatives` and `preferred` are for people: `preferred`
says why `value` is the figure to use, and names it first. Four entries had a `value` that their own
`preferred` text argued against; the lead changed them on 2026-11-11, moving the old figure to the
alternatives with its source:

| File | Fact | Was | Is | Why |
|---|---|---|---|---|
| `tiger1e.yaml` | `mobility.engine_power` | 650 PS | 700 PS | The engine of a July 1943 vehicle |
| `kv1_m1942.yaml` | `machine_guns.count` | 4 | 3 | The guns that fire at ground targets; the fourth is an anti-aircraft mount on every fifth tank |
| `kv1_m1942.yaml` | `mobility.combat_weight_t` | 47.5 t | 52 t | 52 t and 28 km/h come from one table and describe the 1942 tank; 47.5 t beside 28 km/h was a mixed pair |
| `grw42_battery.yaml` | `mortar.max_rate_rpm` | "8-10" | 10 | The entry is the maximum rate; the source prints a range and the maximum is its upper end |

## Files

| File | Unit | Kind | Count per counter |
|---|---|---|---|
| `pz4h.yaml` | Pz IV H platoon | tank | 5 (alternative: 4) |
| `tiger1e.yaml` | Tiger I E platoon | tank | 4 |
| `stug3g.yaml` | StuG III G platoon | assault_gun | 3; battery of 10 recorded separately |
| `de_rifle_company.yaml` | German rifle company | infantry | 142 men |
| `pak40_platoon.yaml` | 7.5 cm Pak 40 platoon | towed_gun | 3 |
| `grw42_battery.yaml` | 12 cm GrW 42 battery | mortar | 4 |
| `t34_76_m1943.yaml` | T-34/76 Model 1943 company | tank | 10 (alternative: 14) |
| `kv1_m1942.yaml` | KV-1 Model 1942 company | tank | 5 |
| `su76m.yaml` | SU-76M battery | self_propelled_gun | 4 (April 1943 table) or 5 (October 1943 table) |
| `su_rifle_company.yaml` | Soviet rifle company | infantry | 143 men (141 after the 1943 amendment) |
| `zis3_battery.yaml` | ZiS-3 battery | towed_gun | 4 |
| `pm38_battery.yaml` | 120 mm mortar battery | mortar | 6 (alternative: 7) |
| `opel_blitz.yaml` | Opel Blitz 3 t | carrier | |
| `sdkfz251.yaml` | Sd.Kfz. 251 | carrier | |
| `zis5_truck.yaml` | ZIS-5 | carrier | |
| `de_horse_wagon.yaml` | Gefechtswagen (Hf. 1/11; Hf. 7/11), two-horse combat wagon | carrier | 3 per rifle company (KStN 131 a) |
| `su_horse_cart.yaml` | One-horse cart, rifle battalion | carrier | 1 per rifle company; 17, with 8 two-horse wagons, per battalion |
| `de_hmg_platoon.yaml` | Heavy machine-gun platoon, German infantry battalion (1944 type; added 2026-11-14, ruling 85) | machine_gun | 55 men, six MG 42 |
| `su_hmg_platoon.yaml` | Machine-gun platoon, Soviet rifle battalion (shtat 04/551; added 2026-11-14, ruling 85) | machine_gun | 18 men, three Maxim |
| `sources.yaml` | Source registry | | Every `source:` key resolves here |

**Totals.** The files hold 362 primary fact entries: 320 verified, 34 secondary and 8 unverified (7 of
them gaps). They also hold 166 recorded alternatives: 145 verified and 21 secondary. (Before the
transport pass of 2026-11-11: 327 entries, 291 verified, 28 secondary, 8 unverified; 132
alternatives, 112 verified and 20 secondary. Before the lead's four changes above: 290, 29 and 8;
113 and 19.) `tests/content/unit-facts.test.ts` prints the count each time it runs.

## File shape

### Top level

| Key | Meaning |
|---|---|
| `schema` | `unit-facts/1` |
| `id` | Stable id, the same as the file name |
| `designation` | Short historical designation, as handbooks write it (bar M2a ruling 7) |
| `full_name` | Fuller name, for the credits page |
| `side` | `german` or `soviet`. This decides the research's `q_optics` (German sights 1.0, Soviet sights of 1941 to 1943 0.85) |
| `kind` | `tank`, `assault_gun`, `self_propelled_gun`, `towed_gun`, `mortar`, `infantry`, `machine_gun` (ruling 85) or `carrier` |
| `setting` | Free text: the period the facts are meant for, and caveats on it |
| `facts` | Nested mapping. Every leaf is a **fact entry** |

### A fact entry

| Key | Required | Meaning |
|---|---|---|
| `value` | yes | Number, string or boolean. A range a source gives as a range is kept as a string, for example `"549 to 732"`. `null` means a gap |
| `unit` | yes | Unit of measure, or `name`, `boolean`, `category` or `description` |
| `source` | yes | A key in `sources.yaml`, or `null` for a gap |
| `locator` | yes | Where in the source: section, table, row or column, or a short quotation. Imperial figures are quoted as printed, and the converted value sits in `value` (1 lb = 0.4536 kg; 1 ft = 0.3048 m; 1 yd = 0.9144 m; 1 mph = 1.609 km/h; 1 short ton = 0.9072 t) |
| `retrieved` | yes | Date read (2026-11-11 for all) |
| `confidence` | yes | `verified`, `secondary` or `unverified`; see below |
| `note` | no | Context, caveats, the source's own reference |
| `alternatives` | no | A list of fact entries from other sources that disagree, or that agree and are worth keeping |
| `preferred` | no | Which value I would use, and why. Present wherever `alternatives` disagree. **No value was averaged** |

### Confidence

- **verified**: I read the value at the cited source in this session. A Wikipedia article counts as
  the source when it is the one cited. Its own reference is named in `locator` or `note` where the
  article gives one.
- **secondary**: the fact really lives in a primary document I could not open (an establishment
  table, a decree, a factory sheet), and I read it in a secondary source that quotes or transcribes
  that document. Most organisation facts for Soviet units, and the GrW 42 minimum range and crew, are
  secondary.
- **unverified**: not read at any source today. See the table at the top.

### Angles

Every angle is recorded **from the vertical**, as the research's armour formula wants. German
Wikipedia prints angles from the horizontal, so 80° there is recorded as 10°. The conversion is
noted in `sources.yaml`. Russian Wikipedia and TM-E 30-451 already measure from the vertical.

### Keys by kind, and the formula of section 3.2 that uses each

**Tanks, assault guns and self-propelled guns** (`pz4h`, `tiger1e`, `stug3g`, `t34_76_m1943`,
`kv1_m1942`, `su76m`):

| Key | Unit | Used by |
|---|---|---|
| `count_per_unit` | vehicles | N in AP and in hard DEF. For StuG III G, `battery_strength` (10) is context |
| `gun.designation`, `gun.calibre_mm` | name, mm | d in penetration P(R) and in the fall-off length Λ |
| `gun.ap_round` | name | Names the standard full-calibre round of 1943 |
| `gun.ap_shot_origin` | `german_capped` or `soviet_wartime` | The quality factor q in P(R): 1.00 for German capped shot, 0.76 for Soviet wartime shot |
| `gun.ap_shot_mass_kg` | kg | m in P(R) and Λ, and in the practical rate r = 6·√(6.8/m)·q_crew·q_mount |
| `gun.ap_muzzle_velocity_ms` | m/s | v_muzzle in P(R), and v̄ in the range formula |
| `gun.he_round`, `gun.he_shell_mass_kg` | name, kg | m_HE in the HE effect m_HE^(2/3)·k, with k = 0.75 for flat-trajectory guns |
| `gun.published_effective_range_m` | m | Check value only; RNG is derived from velocity |
| `gun.published_hit_probability` (Tiger only) | % | Check value for the range-band curve |
| `machine_guns.count`, `.type` | guns, name | The machine-gun weights in HE. Their practical rate and range are in the rifle-company files (see the gaps) |
| `armour.{hull_front, hull_side, turret_front, turret_side}` | | Effective thickness t·c ÷ cos(θ)^n, then Front, Side and A; then hard DEF = A·N ÷ 50 |
| `….thickness_mm` | mm | t |
| `….angle_from_vertical_deg` | degrees | θ |
| `….cast` | boolean | c = 0.95 if true |
| `mobility.road_speed_max_kmh` | km/h | Sustained speed = 0.45 · top road speed · √(power-to-weight ÷ 15), then MOV |
| `mobility.engine_power` | PS or hp, as the source states | Power-to-weight. The research does not convert PS to hp (1 PS = 0.986 hp) |
| `mobility.combat_weight_t` | t | Power-to-weight |
| `crew.total` | men | Not used for a hard target. Kept for the record |
| `crew.in_turret` | men | q_crew: 1.0 for a three-man turret, 0.4 where the commander is also the gunner (a two-man turret). For a casemate vehicle, it is the men serving the gun |
| `traits.height_m` | m | Trait "low profile", under about 2.2 m |
| `traits.ground_pressure_kg_cm2` | kg/cm² | Trait "wide tracks", under 0.8 |
| `traits.radio` | boolean or description | Trait "no radio net" |
| `traits.open_top`, `traits.turretless` | boolean | Traits |

**Towed guns** (`pak40_platoon`, `zis3_battery`) use the same `gun.*` keys. They add:

| Key | Unit | Used by |
|---|---|---|
| `count_per_unit` | guns | N |
| `crew.total` | men per gun | Soft DEF = 0.42·√(men)·1.0. `platoon_men` (Pak 40) is the whole platoon, if the deriver prefers that head count |
| `weight_in_action_kg` | kg | Traits and transport; MOV is 0 for towed guns |
| `traits.height_m` | m | Low profile |
| `traits.towed` | boolean | q_mount = 1.15 in the practical rate; needs transport |
| `gun.rate_of_fire_rpm` | rounds per minute | Reference only (research 2.6: nominal rates are not used) |
| `organic_transport` | description | What the establishment table gives the unit for moving |

**Mortars** (`grw42_battery`, `pm38_battery`):

| Key | Unit | Used by |
|---|---|---|
| `count_per_unit` | tubes | N |
| `mortar.bomb_mass_kg` | kg | m_HE, with k = 1.5 |
| `mortar.max_rate_rpm` | rounds per minute | Mortars fire at half the published maximum |
| `mortar.max_range_m`, `mortar.min_range_m` | m | RNG, and `indirect.minRange` |
| `crew.total`, `platoon_men` | men | Soft DEF |
| `weight_in_action_kg` | kg | Traits and transport |
| `traits.indirect` | boolean | Indirect fire |

**Infantry** (`de_rifle_company`, `su_rifle_company`):

| Key | Unit | Used by |
|---|---|---|
| `count_per_unit` | men | Soft DEF = 0.42·√(men) |
| `rifles` | rifles | Small-arms weights in HE, with weight = √(rate ÷ 10)·min(1.5, √(range ÷ 500)); close combat at 1 each |
| `submachine_guns` | guns | Same hex only; close combat at 2 each |
| `light_machine_guns`, `heavy_machine_guns` | guns | Small-arms weights; close combat at 3 each |
| `short_range_antitank_weapons` | weapons | Close combat against vehicles |
| `weapons.rifle.effective_range_m` | m | Range of the rifle weight, and the infantry RNG |
| `weapons.light_machine_gun.practical_rate_rpm`, `.effective_range_m` | rounds per minute, m | Bipod machine-gun weight |
| `weapons.heavy_machine_gun.practical_rate_rpm`, `.effective_range_m` | rounds per minute, m | Tripod machine-gun weight |
| `weapons.submachine_gun.*` | | Reference |
| `pistols`, `light_mortars` | | Recorded; no formula input |
| `organic_transport` | description | What the table gives the company for moving |

**Carriers** (`opel_blitz`, `sdkfz251`, `zis5_truck`):

| Key | Unit | Used by |
|---|---|---|
| `top_speed_kmh` | km/h | Mounted move: wheeled columns at half top speed on roads (research 3.2, Movement) |
| `troops_carried`, `payload_t`, `tow_role`, `tow_capacity` | men, t | What it carries (rules-v1 section 14: `mounted`) |
| `armour` | mm or `none` | Mounted defense; class factor 0.5 for unarmoured vehicles in soft DEF |
| `open_top` | boolean | Trait |
| `engine_power`, `empty_weight_t`, `combat_weight_t`, `machine_guns`, `height_m`, `drive` | | Recorded; no v1 formula input |
| `crew.total` (`crew.seats` for the German wagon) | men | The vehicle's own crew, not the men it carries |
| `march_speed_kmh` (`opel_blitz`, `sdkfz251`) | km/h | A column's average march speed, from doctrine; a check on "half top speed" |
| `carriers_per_platoon`, `carriers_per_company` (`sdkfz251`) | carriers | Counts per counter, with the table's date |
| `tow_role` | description | What it towed, where a source says so |

**Horse-drawn carriers** (`de_horse_wagon`, `su_horse_cart`) add:

| Key | Unit | Used by |
|---|---|---|
| `draught_horses` | horses | Recorded |
| `payload_t` (and `empty_weight_t`, `loaded_weight_t` for the German wagon) | t | What it carries |
| `carries` | description | Which weapons and loads the tables put on it. No source says infantry rode either army's wagons, so neither file has `troops_carried` |
| `heavy_weapons_traction` | description | How each army's guns and mortars were drawn; none by these wagons |
| `per_rifle_company`, `per_infantry_regiment`, `per_rifle_battalion` | count or description | How many the tables give |
| `speed.walk_kmh`, `speed.trot_kmh` | km/h | A horse's walk and a column at the trot |
| `speed.march_kmh` | km/h | Sustained road march speed: the figure for MOV |
| `speed.daily_march_km` | km per day | Day's march, for scenario design |

## Sources

All are listed with URL, revision and licence in `sources.yaml`. I read all of them in this session.

| Key prefix | Source | Licence or basis |
|---|---|---|
| `tme30-451-hw`, `tme30-451-ls` | War Department, TM-E 30-451, *Handbook on German Military Forces*, 15 March 1945 (HyperWar and Lone Sentry transcriptions) | US government work, public domain (17 U.S.C. 105) |
| `ttt19-1943`, `ttt22-1943`, `ttt25-1943` | *Tactical and Technical Trends* Nos. 19, 22 and 25, February to May 1943 (Lone Sentry) | US government work, public domain |
| `gtd-1942` | Military Intelligence Service, Special Series No. 8, *German Tactical Doctrine*, December 1942 (Lone Sentry) | US government work, public domain |
| `fme101-10-1942`, `fm101-10-1941` | War Department, FM-E 101-10 (enemy forces data, October 1942) and FM 101-10 (US staff data, 1941), PDF scans | US government work, public domain |
| `coeo-1945` | US Office of the Chief of Ordnance, *Catalog of Enemy Ordnance Materiel*, 1945 (Lone Sentry transcription, Internet Archive snapshot) | US government work, public domain |
| `kolesa-zis5-2018` | E. Kochnev, Kolesa.ru, 2018 (one alternative only) | Copyrighted. Individual facts only |
| `ib-1943-07`, `ib-1944-05` | *Intelligence Bulletin*, July 1943 and May 1944 (Lone Sentry) | US government work, public domain |
| `wp-en-*`, `wp-de-*`, `wp-ru-*` | 59 Wikipedia articles in English, German and Russian, with revision ids (10 added in the transport pass) | Facts only. Article text is CC BY-SA 4.0, and none is copied |
| `bs-rifle-bn-dec42`, `bs-rifle-bn-dec42-amended` | G. Kennedy, bayonetstrength.uk, transcription of shtat 04/551 | Copyrighted compilation. Individual facts only; no table layout reproduced |
| `at-rifle-co-04-551` | A. Dyagilev, author.today post 329459 | Copyrighted. Individual facts only |
| `pw-kstn-446b` | Panzerworld, transcription of K.St.N. 446 b (NARA T283 R123) | Copyrighted page. Individual facts only |
| `tankarchives-kv1s` | Tank Archives, "Less Armour, More Mobility", 2017 | Copyrighted. Individual facts only |
| `qms-grw42` | Quartermaster Section, GrW 42 data page | Copyrighted. Individual facts only; the page cites nothing |

**What was not used.** No wargame, board or computer, and none of their rulebooks, counters, data
files, wikis or fan sites, was used. Web searches returned War Thunder, World of Tanks, IL-2,
Company of Heroes, Steel Division and Flames of War pages; none was opened, and nothing comes from
them. No forum rating was used. Nothing came from `../wargames-private/`, the private root files,
`legacy/` or `assets/`. One web-search summary pointed to a Dupuy Institute blog post; it was not
opened.

**What could not be reached.** TM 30-430, *Handbook on USSR Military Forces*: the University of
Nebraska PDFs returned 403 to a direct download. Its chapter III would have been the public-domain
source for every Soviet organisation fact, and that is why those facts are marked secondary.
battleorder.org pages returned 404. The Tank Encyclopedia T-34 page returned 404.

In the transport pass: TM 30-430 again (the Nebraska PDF of chapter III returned 403 behind a
browser check), so no Soviet march rate was found. The live Lone Sentry *Catalog of Enemy
Ordnance* pages returned only server warnings; the Internet Archive snapshot of 6 December 2019 was
read instead. Panzerworld has no transcription of K.St.N. 1114 (the armoured Panzergrenadier
company). militera.lib.ru returned 404 for the Soviet field regulations. Web searches returned
War Thunder, Steel Division, Flames of War, Tide of Iron, Hidden and Dangerous and modelling-forum
pages; none was opened, and nothing comes from them.

## Disagreements that matter to a formula input

Each is recorded in its file with every value, and the preferred value says why.

1. **T-34 turret front.** 52 mm cast (Russian Wikipedia; 45 mm when rolled or pressed) against
   "20-70 mm" overall in the English comparison table, which does not say which face is 70 mm. The
   research used 70. This moves the T-34's front armour more than any other open question here.
2. **T-34 upper hull side.** 45 mm at 40° from 1942 (Russian Wikipedia) against 40 mm at 41° (the
   English infobox, which is the Model 1941). The research used 40.
3. **T-34 ground pressure.** 0.79 kg/cm² for the 1943 model (Russian Wikipedia, Baryatinsky)
   against about 0.72 (English Wikipedia, Kavalerchik). Both are under the 0.8 trait line.
4. **KV-1 Model 1942 weight and speed.** 47.5 t (Tank Archives, quoting factory figures) against
   52 t with 28 km/h (Zaloga and Grandsen, via English Wikipedia). Keep each weight with its own
   speed. Settled by the lead: 52 t with 28 km/h. The cast-turret thickness (95 mm in Russian Wikipedia; 90 to 100 mm under a February 1942
   decree) and the hull appliqué armour are not settled.
5. **Pak 40 muzzle velocity.** 790 or 792 m/s (Wikipedia) against a measured 770 to 776 m/s
   (German October 1943 firing table, US test, TM-E 30-451).
6. **75 mm HE shell.** 5.76 kg (TM-E 30-451, StuK 40 L/48 entry) or 5.69 kg (its Pak 40 entry)
   against 4.42 kg (English Wikipedia, KwK 40 table, "9.75 lb"). The last looks wrong.
7. **German machine-gun practical rate.** 154 rounds a minute as a light machine gun (*Intelligence
   Bulletin*, May 1944) against 250 as a light and 500 as a heavy machine gun (TM-E 30-451). Rifle
   effective range: 500 m (Wikipedia, iron sights) against 800 yd (TM-E 30-451).
8. **Soviet 120 mm mortar maximum rate.** 10 (English Wikipedia) against "up to 15" (Russian
   Wikipedia). The 120 mm battery has 6 mortars (order of 8 October 1942) or 7 (regimental table
   04/551, December 1942), both from Russian Wikipedia.
9. **Soviet rifle company.** As issued in December 1942: 143 men, 12 submachine guns, 103 rifles.
   As amended in 1943: 141 men, 51 submachine guns, 68 rifles. Light machine guns (18) and the heavy
   machine gun (1) are the same in both.
10. **StuG III battery.** 10 guns from 1 November 1942 (Fleischer, via German Wikipedia) against 7,
    with platoons of 2, in the *Intelligence Bulletin* of July 1943, which reports an older pattern.
    The platoon of 3 comes from the February 1944 table.
11. **Pz IV platoon.** 5 (TM-E 30-451, Figure 100, SS company) against 4 (Figure 93, Army company).
12. **Tiger engine.** 650 PS for the first 250 tanks, 700 PS after about May 1943 (settled by the
    lead: 700, for a roster dated July 1943). The German
    Wikipedia turret-front angle (10°) differs from the Russian Wikipedia figure (0°); TM-E 30-451
    gives 0° to 11°.
13. **Soviet heavy machine-gun range.** The Maxim's 2,700 m (English Wikipedia, from a collector
    page) is a sight range, not comparable with the German "effective range" of 2,000 to 2,500 yd.

## Differences from the research's worked example (section 3.4)

| Unit | Research input | This folder | Source for this folder |
|---|---|---|---|
| T-34/76 company | Upper hull side 40 mm at 41° | 45 mm at 40° (from 1942) | `wp-ru-t34` infobox |
| | Turret up to 70 mm | Front 52 mm cast (alternative 70, face unattributed; 45 rolled) | `wp-ru-t34`; `wp-en-t34` table |
| | 52 mm cast turret side [R] | 52 mm, now read; angle 30° (secondary, the earlier turret's) | `wp-ru-t34` |
| | 45 mm lower hull side [R] | 45 mm at 0°, now read | `wp-ru-t34` infobox |
| | 10 tanks per company [R] | 10, now secondary (alternative 14) | `wp-ru-tank-brigade` (Nafziger, US Army CARL) |
| | 53 km/h | 54 preferred; 53 kept as alternative | `wp-ru-t34` table |
| | 0.72 kg/cm² (section 3.2) | 0.79 preferred; 0.72 kept | `wp-ru-t34` table |
| | Shot 655 m/s | Same; 662 m/s recorded as alternative | `wp-ru-t34` |
| Pz IV H platoon | Front plates near 10°, turret sides near 25° [R] | Hull front 10°, turret front 10°, hull side 0°, turret side 25°, now read | `wp-de-pz4` |
| | HE 12.54 lb, cited to TM-E 30-451 | 5.76 kg (12.7 lb). The 12.54 lb is in the handbook's Pak 40 entry, not its Pz IV entry; kept as alternative | `tme30-451-hw`, Ch. VII Sec. V 2.a |
| | 38 to 42 km/h | 40 | `wp-de-pz4` |
| | Platoon of 5, cited to TM-E 30-451 | 5, but the handbook gives 5 only for the SS company (Fig. 100); the Army company has 4 (Fig. 93) | `tme30-451-hw` |
| | 25.0 t | Same; 25.7 kept as alternative | `wp-ru-pz4` |
| Rifle company | Machine gun 150 rounds a minute (Wikipedia, MG 42) | 154 (the primary the article cites); the MG 42 article says 153, and its MG 34 article says 150; TM-E gives 250 for the light and 500 for the heavy role | `ib-1944-05`; `tme30-451-hw` |
| | Implied light and heavy machine-gun inputs | The research's stated weights (4.9 and 8.2) imply a light-gun range near 800 m and a heavy-gun rate near 300, neither in its inputs table. Sources here: light 549 to 732 m; heavy 500 rounds a minute at 1,829 to 2,286 m | `tme30-451-hw`, Ch. VII Sec. II 6.b |
| | Six short-range anti-tank teams (assumption) | 0 on the company table. Panzerfaust first delivered August 1943 | `tme30-451-hw` Fig. 35; `wp-en-panzerfaust` |
| | Submachine guns not listed | 28 | Fig. 35 |
| 75 mm anti-tank gun platoon | 792 m/s | 790 preferred; 792, 770, 776 and 771 kept | `wp-en-pak40`; `tme30-451-hw` |
| | HE not listed | 5.69 kg | `tme30-451-hw` |
| 120 mm mortar battery | Used Soviet M1938 and 120-PM-43 data for the German battery | German GrW 42 data recorded separately: 15.6 kg, 6,000 m, minimum 600 m (secondary), 8 to 10 rounds a minute, crew 6 (secondary), 280 kg | `grw42_battery.yaml` |
| | 500 m minimum (120-PM-43) | M1938: 460 m; 500 kept as alternative | `wp-ru-pm38` |
| | 9 to 10 rounds a minute | 10; 15 (Russian Wikipedia) and 9 (PM-43) kept | `wp-en-m1938-mortar` |
| | 6 tubes (Soviet) [R] | 6, now secondary; 7 under table 04/551 kept | `wp-ru-rifle-regt` |
| Truck platoon | 25 men, 60 km/h | Same | `wp-en-zis5-truck` |
| | Platoon of 6 trucks | No source gives a truck platoon; rules-v1 section 14.3 has no transport counters | |

The research's other inputs match the values here: T-34 30.9 t, 500 hp, 45 mm at 60°, F-34 6.3 kg,
OF-350 6.21 kg; Pz IV 6.8 kg at 750 m/s, 80/30/50/30 mm, 300 PS; rifle company 142, 96, 13 and 2;
Pak 40 6.8 kg, crew 6, 1,425 kg, 1,800 m, 3 guns, 1.25 m; the M1938's 15.9 kg, 5,700 m, crew 6,
280 kg; 4 tubes from Figure 37.

## Gaps

- **German rifle company, 1943.** Only the handbook's 1944 table (142 men) was found. The 1943
  company was larger, but no table was opened.
- **Pz IV platoon, 1943 Army.** K.St.N. 1175 of 1943 (22 tanks, platoons of 5) appeared only in
  web-search summaries.
- **StuG III platoon, 1943.** The platoon of 3 is read from the February 1944 table (secondary).
- **T-34 hexagonal turret.** The front angle is a gap. The side angle is the earlier turret's (30°)
  and is marked secondary.
- **KV-1 Model 1942.** The cast turret's angles are taken from the welded turret (secondary). Whether
  the 1942 hull carried appliqué armour is open. Weight is 47.5 or 52 t.
- **SU-76M.** Ground pressure is a gap. The armour plates come from the infobox of the 1942 SU-76,
  which the English article says kept the same layout.
- **ZiS-3.** No published effective range.
- **GrW 42.** Minimum range and crew come only from an uncited collector page.
- **Vehicle machine guns.** No source gives a separate practical rate for the tank MG 34 or the DT.
  The rifle-company files give the MG 34 and MG 42 (about 150 a minute, *Intelligence Bulletin*) and
  the DP (80 a minute). The DT is the tank version of the DP, but that was not sourced.
- **Carriers.** Opel Blitz troop seats, tow capacity and crew, and the ZIS-5's crew, are gaps. No
  table names the towing vehicle of the Pak 40 platoon (5 motor vehicles) or of the GrW 42 platoon
  (7); the English Pak 40 article names the Opel Blitz and the Sd.Kfz. 251 among its usual prime
  movers. The Sd.Kfz. 251 angles come from an early-pattern vehicle (see below). The armoured
  Panzergrenadier company of 1943 was not found: its 21 carriers are from the 1945 handbook.
- **Horse-drawn transport.** No Soviet march rate; no seat or crew count for the German Hf. 1; no
  draught for the GrW 42; how a horse-drawn infantry division moved its Pak 40 was not found; the
  ZiS-3 article gives a limber but no team size (six horses is the ZiS-2's, on the same limber).
- **Soviet submachine gun model.** Unnamed in the tables.

## Transport facts (added 2026-11-11)

The owner directed that transports be units of their own, horse-drawn wagons among them. This pass
added two files and filled gaps in the three motor carriers. Nothing was computed except unit
conversions (miles, pounds, and angles "to the horizontal" turned to "from the vertical").

**Added.**

- `de_horse_wagon.yaml`: the infantry company's two-horse combat wagon. Hf. 1 values (payload
  0.5 t; 610 kg empty, 1,360 kg loaded), with the Hf. 7/11 (1.72 t) as alternative. Three per rifle
  company under the 1937 table that TM-E 30-451 says lasted until the fall of 1943; 210 horse-drawn
  vehicles per old-type infantry regiment.
- `su_horse_cart.yaml`: the rifle battalion's one-horse cart, 450 to 500 lb (*Tactical and Technical
  Trends* No. 25, May 1943); one per rifle company (its heavy machine gun); a driver per cart.
- How guns were drawn: ZiS-3 by horse team with the unified limber of 1942 or by truck; the 120 mm
  mortar by four horses or a truck; the battalion's 45 mm gun by four horses; the Pak 40
  motor-drawn; the German infantry guns horse- or motor-drawn.
- `sdkfz251.yaml`: front plate 35° and sides 30 to 35° from the vertical; crew 2; 4 carriers a
  platoon (April 1943), 21 a company (1945 handbook); march speed 24.1 km/h; Pak 40 prime mover.
- `opel_blitz.yaml`: Pak 40 prime mover; march-column speed 35.4 km/h (25.7 with a trailer); crew is
  a gap. `zis5_truck.yaml`: crew is a gap; a magazine's "12 to 24" kept as an alternative to 25.

**Speeds for horse-drawn transport, and what I would take.** Walk 7 km/h (a horse's gait). Trot
10 km/h (German doctrine for mounted troops; a horse's average is 13, and a Soviet gun manual's
maximum 15). The figure for movement is the sustained march: 4.83 km/h (3 mph) for the German horse-drawn
infantry division, day and night (TM-E 30-451), between German doctrine's 4 with rests and 5 without.
For the Soviet cart no Soviet figure was found; the value is the US figure for animal-drawn trains,
5.63 km/h (3½ mph), and the German 4.83 is the alternative. A wagon marching with its infantry moves at the
column's pace.

**Still missing.** Listed under Gaps above.

## Spot check: ten facts re-opened

I read the files again as a sceptic, then re-downloaded the live source for ten facts across the
files and compared. All ten held.

| # | File and fact | Re-opened source | Held? |
|---|---|---|---|
| 1 | `pz4h` hull front 80 mm at 80° from horizontal, Ausf. H column | `wp-de-pz4` technical table | Yes |
| 2 | `tiger1e` ground pressure 1.03 kg/cm² | `wp-de-tiger` technical table | Yes |
| 3 | `stug3g` superstructure front 50+30 mm at 9° | `wp-ru-stug` infobox | Yes |
| 4 | `de_rifle_company` total row: 2, 21, 119, 96, 22, 28, 13, 2 | `tme30-451-hw` Figure 35 | Yes |
| 5 | `pak40_platoon` weight in action 3,136 lb | `tme30-451-hw` Chapter VII | Yes |
| 6 | `grw42_battery` bomb 15.6 kg | `wp-en-grw42` infobox | Yes |
| 7 | `t34_76_m1943` ground pressure 0.79 (1943 column) | `wp-ru-t34` TTX table | Yes |
| 8 | `kv1_m1942` cast turret 95 mm against welded 75 mm | `wp-ru-kv1` text | Yes |
| 9 | `su76m` light regiment of 20 in five batteries of four (April 1943) | `wp-ru-sap` | Yes |
| 10 | `zis5_truck` 25 soldiers on five benches | `wp-en-zis5-truck` | Yes |

The sceptical read changed four things before the spot check:

- The Tiger HE shell name was corrected to the article's spelling.
- The TM-E 30-451 locators were corrected to section numbers.
- The ZIS-5 engine figure was re-read and raised from secondary to verified.
- The StuG III platoon of 3 was raised from unverified to secondary, once the 1944 table was found.

## Checks run

- Every file parses with the repo's `yaml` package, with `uniqueKeys` on.
- Every `source:` key resolves in `sources.yaml`.
- Every fact entry has `value`, `unit`, `source`, `locator`, `retrieved` and `confidence`.

### Checked at the source, 2026-11-11

Twelve fresh agents re-opened the source of each of the 60 entries added or filled that day, and a
second agent looked again at every difference. Every reading was right. Corrected after it: three
values that had been rounded past the half per cent a conversion is allowed (the German march speed,
4.8 to 4.83; the US animal-drawn rate, 5.6 to 5.63; the cart's payload, "0.20 to 0.23" to "0.204 to
0.227"); three locators (the handbook's march-speed tables are on p. VI-26 and its animal-drawn
columns in Section III on p. VI-17); and a table number in a note (04/401, not 04/400). Things the
check asks a deriver to keep in mind, none of which changes a value: the handbook's 3 mph for the
infantry division is probably the German 5 km/h in round miles; the Hf. 1's payload of 0.5 t comes
from an infobox whose weights do not add up (the article's table and the US manual agree on about
0.75 t); the half-track's front thickness and front angle come from two sources that do not say
they describe the same plate; "with a trailer or a towed gun" for the truck's slower march rate is
this file's reading of "trucks with trailers".
