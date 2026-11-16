/**
 * Every dial of the table's effects, in one table. Lengths are in h (a hex across its flats; a
 * counter is 0.82 h square), times in seconds, speeds in h a second, colours as sRGB 0..255.
 *
 * The address overrides any of them, so a look can be tuned by reloading:
 *   &fx.<group>.<dial>=<number>            &fx.kill.size=3.1
 *   &fx.<group>.<dial>=<n>,<n>,<n>         &fx.kill.glow=255,170,90   (a colour, or any dial of several numbers)
 * An override that names no dial, or gives the wrong count of numbers, is reported on the page's
 * hook (`__table.settings.ignored`) and changes nothing. Plain numbers, no browser.
 */

export const FX_TUNE = {
  all: {
    /** Gains on everything: every size, every clock (2 plays everything twice as fast), every count of particles, every light. */
    size: 1,
    speed: 1,
    count: 1,
    bright: 1,
    /** The air over the table: smoke drifts this way, h a second on the plan (x right, y down the board). */
    wind: [0.32, -0.12],
    /** Frames a second while nothing but smoke and fire is moving (they drift slowly; the table's own motion is never slowed). */
    ambientFps: 30,
    /** Never more bright flashes than this in any one second; one too many is drawn at `dimFlash` of its light. */
    flashesPerSecond: 3,
    dimFlash: 0.22,
    /** With fast=1 in the address: every clock runs this much faster, a kill holds its counter this share of `kill.holdS`, and lasting effects last this share of their time. */
    fastSpeed: 2.2,
    fastHold: 0.12,
    fastLasting: 0.2,
    /** For a viewer who asks for less motion: shares of the counts, of a flash's light, and of a lasting effect's time. */
    reducedCount: 0.5,
    reducedFlash: 0.2,
    reducedLasting: 0.6,
    /** On the flat tier (top-down, unlit, one pixel a pixel): the share of the counts drawn. */
    flatCount: 0.6,
    /** How dark smoke's shadow on the board is at most, and how fast it softens and pales with the smoke's height (a share a h). */
    shadow: 0.34,
    shadowSoften: 0.22,
    /** A sprite is eased out over this height above the board, so that none is cut by it. */
    groundSoft: 0.16,
    /** Smoke is a warm grey, as the room's light is: its red and its blue as shares of its grey. */
    smokeWarm: [1.04, 0.92],
    /** Smoke in the table's light: the room's share, the key's share, and how far round a puff the key's light wraps. */
    smokeAmbient: 0.5,
    smokeKey: 0.72,
    smokeWrap: 0.55,
    /** How upright a flame stands seen from straight above (0 lies with the wind, 1 stands edge-on and vanishes), and the tilt of the camera (degrees from straight down) from which it stands fully. */
    flameTop: 0.34,
    flameFullTiltDeg: 50,
    /** A flame seen from straight above is drawn this share of its height. */
    flameTopLength: 0.62,
  },
  /** A tank's or an anti-tank gun's shot. */
  gun: {
    /** After the game says fire is being drawn: seconds before the first gun fires, and between guns that fire together. */
    delayS: 0.16,
    staggerS: 0.11,
    /** How far the muzzle is from the middle of the counter, and how high. */
    barrel: 0.46,
    height: 0.2,
    /** The flash: its length along the barrel, how long it lasts, the side flashes of a muzzle brake as a share of it (0 none). */
    flash: 1.05,
    flashS: 0.1,
    brake: 0.45,
    flashInk: [255, 222, 160],
    /** The light it throws on the board: reach, strength, seconds. */
    lightReach: 2.1,
    light: 0.9,
    lightS: 0.16,
    lightInk: [255, 196, 120],
    /** The puff that hangs: how many, how large it grows, seconds, cover, its grey (0 black to 255 white), how fast it is thrown forward. */
    puffs: 5,
    puff: 1.2,
    puffS: 2.6,
    puffAlpha: 0.68,
    puffGrey: 168,
    puffThrow: 2.6,
    /** Dust kicked off the ground under the muzzle: size, cover. */
    dust: 1.1,
    dustAlpha: 0.2,
    /** The shell: speed, the streak's length and width, its ink. */
    shellSpeed: 46,
    shellLength: 1.5,
    shellWidth: 0.075,
    shellInk: [255, 204, 118],
  },
  /** Machine guns and rifles. */
  small: {
    delayS: 0.14,
    staggerS: 0.13,
    barrel: 0.38,
    height: 0.16,
    /** Tracers in a run, seconds between them, their speed, length, width, how far they scatter at the target, their ink. */
    rounds: 6,
    gapS: 0.075,
    speed: 34,
    length: 0.85,
    width: 0.055,
    scatter: 0.3,
    ink: [255, 178, 66],
    /** The glow at the muzzle for the length of the run (one steady glow, never a flicker). */
    glow: 0.42,
    glowAlpha: 0.7,
    /** Small puffs at the muzzle: how many, size, seconds, cover. */
    puffs: 3,
    puff: 0.36,
    puffS: 1.3,
    puffAlpha: 0.3,
    /** What each round kicks up where it lands: size, cover. */
    kick: 0.3,
    kickAlpha: 0.3,
  },
  /** A mortar's or a gun's round sent high. */
  lob: {
    delayS: 0.16,
    staggerS: 0.16,
    /** The thump at the tube: smoke puffs, their size, seconds, cover; the flash's size. */
    puffs: 5,
    puff: 0.85,
    puffS: 2.4,
    puffAlpha: 0.55,
    flash: 0.5,
    /** The round: seconds in the air (and more for each h of the way), how high it climbs, its size. */
    flightS: 0.75,
    flightPerH: 0.022,
    apex: 3.4,
    round: 0.11,
    /** The trail it leaves: cover. */
    trailAlpha: 0.22,
  },
  /** A round arriving on armour: a flash and sparks. */
  hit: {
    flash: 0.75,
    flashS: 0.11,
    flashInk: [255, 236, 190],
    lightReach: 1.7,
    light: 0.8,
    lightS: 0.14,
    /** Sparks: how many, speed, seconds, length, width, ink at birth and as they cool. */
    sparks: 16,
    sparkSpeed: 5.6,
    sparkS: 0.46,
    sparkLength: 0.24,
    sparkWidth: 0.036,
    sparkInk: [255, 226, 150],
    sparkCool: [255, 120, 40],
    /** The small grey puff left: size, seconds, cover. */
    puff: 0.7,
    puffS: 1.4,
    puffAlpha: 0.34,
    /** How far from the target's middle it lands, toward the firer (the counter's edge). */
    edge: 0.36,
  },
  /** A round arriving on soft ground, or beside its target: dirt and smoke. */
  dirt: {
    /** The burst: size, seconds, cover, the earth's ink. */
    size: 1.35,
    burstS: 1.0,
    alpha: 0.82,
    ink: [128, 108, 82],
    /** Clods thrown up: how many, speed, size, ink. */
    clods: 11,
    clodSpeed: 4.2,
    clod: 0.05,
    clodInk: [70, 58, 44],
    /** The low dust that spreads after: size, seconds, cover. */
    dust: 1.5,
    dustS: 1.7,
    dustAlpha: 0.24,
    flash: 0.4,
    /** How far beside the target's middle a round at a soft target lands. */
    beside: 0.3,
  },
  /** A kill: the explosion. */
  kill: {
    /** Seconds the counter stays under the blast before it is taken to the tray (never more than about 0.4). */
    holdS: 0.3,
    /** The fireball: the width of its picture, seconds it plays, how high its middle stands. */
    size: 2.7,
    ballS: 1.3,
    height: 0.9,
    /** How much brighter than its picture the fire in it is drawn. */
    gain: 1.55,
    /** The first flash: size, seconds, ink. */
    flash: 2.3,
    flashS: 0.17,
    flashInk: [255, 240, 200],
    /** The warm light thrown on the board and the counters round it: reach, strength, seconds, ink. */
    lightReach: 3.6,
    light: 1.25,
    lightS: 0.85,
    glow: [255, 176, 96],
    /** Burning pieces thrown out: how many, speed, size, seconds. */
    embers: 5,
    emberSpeed: 2.6,
    ember: 0.55,
    emberS: 0.55,
    /** Sparks: how many, speed, seconds. */
    sparks: 24,
    sparkSpeed: 7.5,
    sparkS: 0.75,
    /** Debris: how many, speed, size. */
    debris: 9,
    debrisSpeed: 4.4,
    chip: 0.05,
    /** The smoke that rolls out low: how many puffs, size, seconds, cover. */
    roll: 5,
    rollSize: 1.2,
    rollS: 2.4,
    rollAlpha: 0.4,
  },
  /** A blast of high explosive: an arriving shell, or the end of men and guns. */
  blast: {
    size: 1.7,
    ballS: 1.05,
    height: 0.55,
    gain: 1.4,
    flash: 1.3,
    flashS: 0.13,
    lightReach: 2.6,
    light: 1.0,
    lightS: 0.5,
    sparks: 10,
    clods: 12,
    /** The smoke that hangs after it: puffs, size, seconds, cover. */
    puffs: 4,
    puff: 1.3,
    puffS: 3.2,
    puffAlpha: 0.42,
  },
  /** The wreck burning after a kill. */
  fire: {
    /** Seconds after the blast that the fire takes hold; seconds it burns at full; the second by which the last smoke has gone. */
    startS: 0.2,
    burnS: 9,
    endS: 19,
    /** Flames: how many, their height, how far apart they stand. */
    flames: 3,
    flame: 1.0,
    spread: 0.2,
    /** How much brighter than its picture a flame is drawn; the balls of fire at its foot: how many alive, size. */
    gain: 1.5,
    balls: 4,
    ball: 0.56,
    /** The ink the balls of fire are steeped in (their picture is white-hot at its heart; a wreck's fire is orange). */
    ballInk: [255, 176, 70],
    /** The soft glow over the fire's foot: its size as a share of a ball's, and its strength. */
    ballGlow: 1.8,
    ballGlowAlpha: 0.09,
    /** A fire is drawn as if this much nearer (h): it shines through the smoke that rises over it, which seen from straight above would lie on it and hide it. */
    through: 3,
    /** The column: puffs a second, how fast it rises, seconds a puff lives, its size at birth and at its end, cover, its grey. */
    smokeRate: 3.8,
    rise: 0.42,
    smokeS: 5.2,
    smoke0: 0.34,
    smoke1: 1.75,
    smokeAlpha: 0.56,
    smokeGrey: 34,
    /** The fire's light on the board: reach, strength, how much it wavers; its ink. */
    lightReach: 1.9,
    light: 0.42,
    waver: 0.3,
    glow: [255, 150, 60],
    /** The soot under it: reach, darkness. */
    soot: 0.62,
    sootDark: 0.3,
    /** While a counter stands in the burning hex the fire and its smoke are held to this share, so the counter can be read. */
    occupied: 0.34,
  },
  /** A smoke screen lying over a hex. */
  screen: {
    /** Puffs alive at once, how far from the hex's middle they lie, their size, how high the bank stands. */
    puffs: 8,
    reach: 0.36,
    size: 1.08,
    height: 0.34,
    /** Seconds a puff lives; cover; cover while a counter stands in the hex; its grey. */
    puffS: 7,
    alpha: 0.5,
    occupiedAlpha: 0.3,
    grey: 204,
    /** Seconds the bank takes to gather, and to thin when the marker is taken up. */
    inS: 1.3,
    outS: 1.8,
    /** How far the wind carries a puff of the bank in its life, as a share of what it does to free smoke. */
    drift: 0.12,
  },
  /** A fire mission arriving: several bursts. */
  mission: {
    bursts: 5,
    overS: 1.0,
    /** How far from the hex's middle a burst may fall, and its size as a share of a blast's. */
    spread: 0.44,
    size: 0.8,
    /** Seconds after the marker is taken up that the first round arrives (a new game cancels it in that time). */
    delayS: 0.12,
    /** The streak of a round coming in: how far up it is first seen, seconds it takes. */
    fromHeight: 5,
    fallS: 0.16,
  },
  /** A vehicle moving. */
  dust: {
    /** A puff for every this much of the way; its size, seconds, cover, ink. */
    every: 0.34,
    size: 0.8,
    puffS: 1.3,
    alpha: 0.4,
    ink: [172, 152, 120],
    /** Wheels raise this share of what tracks do. */
    wheeled: 0.6,
    /** The exhaust at the start: puffs, size, seconds, cover, its grey. */
    exhaust: 3,
    exhaustSize: 0.5,
    exhaustS: 1.1,
    exhaustAlpha: 0.34,
    exhaustGrey: 52,
  },
  /** The table's answers to what a player does: what a click would do, shown at the pointer's hex; badges; refusals. (These stay on with fx=0.) */
  mark: {
    /** A badge: seconds it lives, how far it floats up (in counters' heights), pixels between two at one hex. */
    badgeS: 1.4,
    rise: 1,
    stack: 26,
    /** A refusal: seconds its X shakes, seconds its words stay, the X's size in pixels. */
    shakeS: 0.56,
    whyS: 1.5,
    cross: 40,
    /** What a click would do: seconds it takes to glide to another hex, and to come and go; pixels between it and the counter it is over. */
    glideS: 0.09,
    fadeS: 0.14,
    gap: 7,
    /** With the effects off, a shot is a plain stroke from the firer to its target: seconds. */
    shotS: 0.36,
    /** Inks: the strokes and words, the paper under them, and the three tones of an answer. */
    ink: [30, 32, 38],
    paper: [251, 248, 240],
    good: [28, 110, 60],
    bad: [180, 38, 32],
    plain: [44, 50, 60],
    shot: [226, 120, 30],
  },
  /** A thin wisp over a suppressed unit. */
  wisp: {
    /** Wisps a second, size, seconds, cover, its grey; 0 wisps a second leaves it off. */
    rate: 1.6,
    size: 0.62,
    wispS: 2.1,
    alpha: 0.34,
    grey: 150,
    rise: 0.3,
  },
};

export type FxTune = typeof FX_TUNE;

/** A copy of the table with the address's overrides applied; `ignored` lists those that named no dial or gave the wrong numbers. */
export function tuneWith(overrides: Readonly<Record<string, readonly number[]>>): { tune: FxTune; ignored: string[] } {
  const tune = JSON.parse(JSON.stringify(FX_TUNE)) as FxTune;
  const ignored: string[] = [];
  for (const [name, values] of Object.entries(overrides)) {
    const parts = name.split('.');
    const group = parts.length === 2 ? (tune as unknown as Record<string, Record<string, number | number[]>>)[parts[0] as string] : undefined;
    const dial = parts[1] as string;
    const now = group && Object.prototype.hasOwnProperty.call(group, dial) ? group[dial] : undefined;
    if (!group || now === undefined || values.length === 0 || values.some(v => !Number.isFinite(v))) {
      ignored.push(`fx.${name}=${values.join(',')}`);
      continue;
    }
    if (Array.isArray(now)) {
      if (values.length !== now.length) ignored.push(`fx.${name}=${values.join(',')}`);
      else group[dial] = [...values];
    } else if (values.length !== 1) ignored.push(`fx.${name}=${values.join(',')}`);
    else group[dial] = values[0] as number;
  }
  return { tune, ignored };
}

/** An sRGB ink (0..255) as linear light (0..1). */
export function linearInk(ink: readonly number[]): [number, number, number] {
  const f = (v: number): number => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f(ink[0] ?? 0), f(ink[1] ?? 0), f(ink[2] ?? 0)];
}
