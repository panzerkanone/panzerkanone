/**
 * The game's name, and every word the title screen shows a player.
 *
 * `GAME` is the one place in the code where the name is written: the title screen's nameplate, the
 * page's title and any other part of the game that names it take it from here. (The title
 * lettering itself is the owner's painting: assets/shell/v1/title.webp.)
 *
 * Plain modern English, American spelling. Nothing here is logic.
 */

export const GAME = {
  name: 'Panzer Kanone',
  subtitle: 'Armored Warfare',
  /** The second line of the nameplate. */
  edition: 'Developer Edition',
} as const;

/** The nameplate's second line: the edition, and the build's version beside it (client/src/version.ts: `dev`, or the published build's tag). */
export const editionLine = (version: string): string => `${GAME.edition} · ${version}`;

/**
 * The version the nameplate shows: the build's own, or for a capture the one the address gives
 * (`version=`), when that is one: letters, digits, dots, plus and hyphen, 24 at most.
 */
export const versionShown = (own: string, asked: string | null): string => (asked !== null && /^[A-Za-z0-9.+-]{1,24}$/.test(asked) ? asked : own);

export const WORDS = {
  menu: {
    scenario: 'Play Scenario',
    campaign: 'Play Campaign',
    multiplayer: 'Multiplayer',
    settings: 'Settings',
  },
  /** The answer to a press on a plate that leads nowhere yet. */
  notYet: 'Not available yet.',
  /** What a screen reader is told a plate that leads nowhere is. */
  notYetLabel: 'not available yet',
  menuLabel: 'Main menu',
  /** What a screen reader is told the PLAY GAME medallion is (its own words are painted on it). */
  playLabel: 'Play game: starts the music and shows the menu.',
  settings: {
    heading: 'Settings',
    /** The left page's heading, over the two sliders. */
    volumes: 'Music & Sound Volume',
    music: 'Music',
    sound: 'Sound',
    volume: 'volume',
    difficulty: 'AI Difficulty',
    difficulties: { easy: 'Easy', normal: 'Normal', hard: 'Hard' },
    /** What each level of the computer opponent does (the opponent's builder's words). */
    difficultyNotes: {
      easy: 'The computer plays like someone still learning the game: it heads for the objectives and shoots at what it can see, but it uses its units one at a time and often settles for a good move instead of its best one.',
      normal: 'The computer plays a sound game: it pairs units up for an attack and keeps some ready to fire at your moves, but it plans only a short way ahead.',
      hard: 'The computer plays its best game: it masses the fire of several units on one target, softens a tank with fire before its infantry charge, and thinks further ahead, with the same dice and the same information you have.',
    },
    detail: 'Graphic Detail Level',
    details: { low: 'Low', med: 'Med', high: 'High' },
    /** The word on the red frame round the chosen level of detail. */
    chosen: 'selected',
    apply: 'Apply',
    cancel: 'Cancel',
    back: 'Back',
    applied: 'Settings applied.',
    nothingToApply: 'Nothing to apply.',
    undone: 'Changes undone.',
    nothingToUndo: 'Nothing to undo.',
    notApplied: 'Changes not applied.',
    noSound: 'Not available on this page.',
    /** The right-hand page's two tabs, both written by the screen in one face. */
    filesTab: 'Files',
    advancedTab: 'Advanced',
    advanced: 'Advanced',
    /** The Advanced page's options: each a name and a short line under it. */
    hulks: 'Show hulks',
    hulksLine: 'Wrecks mark where vehicles were destroyed. No rule changes.',
    craters: 'Show craters',
    cratersLine: 'Craters mark where fire missions landed. No rule changes.',
    /** The last row of the Advanced page: it opens the About panel (about.ts). */
    about: `About ${GAME.name}`,
    aboutLine: 'Who made the game, and with what.',
  },
  /**
   * The About panel (about.ts): who made the game and with what, and thanks to the makers whose free work it uses
   * (tests/shell/about.test.ts holds the thanks to every third-party maker in assets/LEDGER.yaml). The maker goes by
   * "grognard" only (the owner, 2026-11-15: no real name in the game).
   */
  about: {
    title: `About ${GAME.name}`,
    madeBy: 'Made by grognard',
    grognard: 'grognard is a game engineering veteran who wanted to scratch a persistent itch.',
    game: `${GAME.name} (${GAME.subtitle}) is an original game of tanks and infantry on the Eastern Front in 1943. It uses no board, scenario, counter, rule or table of any published game.`,
    version: (v: string): string => `Version ${v}. Play it at panzerkanone.com.`,
    source: 'The source is at github.com/panzerkanone/panzerkanone. The code is under the MIT license, and the game’s own art and content under CC BY 4.0.',
    aiHead: 'Made with AI',
    ai: 'AI was used extensively and extravagantly, some might even say gratuitously, to make this game: Claude, Nano-Banana, Codex, FAL, Comfy, Meshy, Suno and ElevenLabs.',
    ultracode: 'Claude Fable 5.2 Ultracode ran for about five hours solving optics equations to give the projector realistic light.',
    thanksHead: 'Thanks to',
    thanks: [
      'Sound recordings from Freesound by ani_music, BenDrain, cognito perceptu, ekfink, el_boss, Franki-01234, Garuda1982, gfrog, GreekIrish, gusgus26, Heigh-hoo, j1987, kermite607, LadyOfTheWifi, Logicogonist, MegaPenguin13, MPierluissi, Walking.With.Microphones, wilhellboy, Za-Games and Zagge28.',
      'Fire, blast and smoke by Thomas Iché, Unity Technologies.',
      'Textures and light from Poly Haven by Greg Zaal, Alexander Scholten, Sergej Majboroda, Jenelle van Heerden, Rico Cilliers and Dimitrios Savva.',
      'Film from The Battle of Russia (1943), made by the US War Department with the Signal Corps, from the National Archives.',
      'Type: Stick No Bills, by the Stick No Bills Project Authors; Lekton, by the Accademia di Belle Arti di Urbino.',
    ],
    close: 'Close',
  },
  scenarios: {
    heading: 'Choose a Scenario',
    /** The list, for a screen reader. */
    listLabel: 'Scenarios',
    /** The row of a scenario's levels (Patrol, Skirmish, Battle, Offensive: their names are the game's), for a screen reader. */
    levelsLabel: 'Levels',
    turns: 'turns',
    /** The units' count of the chosen level: "12 German and 15 Soviet units". */
    and: 'and',
    units: 'units',
    next: 'Choose Side',
    back: 'Back',
    loading: 'Loading the scenarios…',
    failed: 'The scenarios could not be loaded.',
    /** The offer to go on with the battle kept in the browser (game/keep.ts): its title and the turn it is in. */
    continueAsk: (title: string, turn: number): string => `Continue your battle: ${title}, turn ${turn}?`,
    continue: 'Continue',
    newBattle: 'New battle',
  },
  /** Play Campaign: the list, the briefing room (its intro, between battles, the end) and its pop-outs. */
  campaign: {
    heading: 'Choose a Campaign',
    listLabel: 'Campaigns',
    sidesLabel: 'Sides',
    battles: 'battles',
    hours: (h: number): string => `About ${h} ${h === 1 ? 'hour' : 'hours'}`,
    next: 'Briefing',
    back: 'Back',
    continueBand: (title: string, side: string, k: number, n: number): string => `Continue: ${title} · ${side} · battle ${k} of ${n}`,
    loading: 'Loading the campaigns…',
    failed: 'The campaigns could not be loaded.',
    /** The bar's painted words, for a screen reader. */
    intro: 'Campaign Intro',
    briefing: 'Campaign Briefing',
    youCommand: 'You command',
    stakes: (side: string): string => `${side} stakes:`,
    rewards: 'Replacements by result',
    results: { decisive: 'Decisive victory', victory: 'Victory', defeat: 'Defeat', heavy: 'Heavy defeat' },
    /** Beside a result on the clipboard: the campaign points it brings. */
    points: (n: number): string => `${n} ${n === 1 ? 'point' : 'points'}`,
    pointsRule: (victory: number, most: number): string => `Victory at ${victory} of ${most} points.`,
    objectives: 'Objectives',
    start: 'Start Campaign',
    continue: 'Continue',
    log: 'Campaign Log',
    plateBack: 'Back',
    replaceAsk: (title: string, side: string, k: number, n: number): string => `This replaces your saved campaign (${title}, ${side}, battle ${k} of ${n}).`,
    replaceYes: 'Start Anyway',
    replaceNo: 'Keep It',
    barBattle: (title: string, k: number, n: number): string => `${title} · Battle ${k} of ${n}`,
    barEnd: (title: string): string => `${title} · The End`,
    nextBattle: 'Next Battle',
    turns: 'turns',
    aim: 'Your aim:',
    perTurn: 'a turn',
    against: 'Against you:',
    moveFirst: 'You move first.',
    moveSecond: 'The enemy moves first.',
    startBattle: 'Start Battle',
    continueBattle: 'Continue Battle',
    mainMenu: 'Main Menu',
    inHand: 'Replacement points:',
    soFar: (total: number, victory: number, most: number): string => `Campaign points ${total} · Victory at ${victory} of ${most}`,
    undo: 'Undo',
    staysBack: 'Stays back',
    cancel: 'Cancel',
    bought: (type: string, name: string, left: number): string => `${type} bought for the ${name}. ${left} points left.`,
    takenBack: (name: string, back: number): string => `The ${name}'s replacement taken back: ${back} points returned.`,
    cannot: 'Not enough replacement points.',
    /** The battle group's sheet between battles: its plate, its one line of what to do, and its cards' lines. */
    battleGroup: 'Battle Group',
    putAway: 'Put Away',
    todoReplace: 'Replace your losses with the points in hand, then press Start Battle.',
    todoNoPoints: 'You have too few points to replace a unit. Press Start Battle.',
    todoFull: 'Your battle group is at full strength. Press Start Battle.',
    todoBattle: 'A battle is in progress. Press Continue Battle.',
    todoChoose: (name: string): string => `Choose what takes the place of the ${name}:`,
    lostWhere: (battle: string): string => `at ${battle}`,
    /** The sheet's head: one fact a line, a label and its figures. */
    strengthLabel: 'Strength',
    strengthValue: (now: number, full: number): string => `${now} of ${full} points`,
    afterLabel: (battle: string): string => `After ${battle}`,
    afterValue: (result: string, mine: number, theirs: number): string => `${result}, ${mine} to ${theirs}`,
    broughtLabel: 'It brought',
    broughtValue: (points: number, earned: number): string => `+${points} campaign ${points === 1 ? 'point' : 'points'}, +${earned} replacements`,
    campaignLabel: 'Campaign points',
    campaignValue: (total: number, victory: number, most: number): string => `${total} of ${most}, victory at ${victory}`,
    lost: 'Lost',
    replaceFor: (cost: number): string => `Replace · ${cost}`,
    buyFor: (type: string, cost: number): string => `${type} · ${cost}`,
    spent: (cost: number): string => `Bought for ${cost}`,
    fillNote: 'Cheapest first, while points last.',
    /** The automatic choice of replacements (the owner's): it buys back lost units, cheapest first, while the points last. */
    fill: 'Fill for Me',
    filled: (n: number, left: number): string => `${n} ${n === 1 ? 'unit' : 'units'} bought back. ${left} points left.`,
    nothingToFill: 'Nothing could be bought back with the points in hand.',
    result: 'Campaign Result',
    verdicts: { victory: 'Victory', draw: 'Draw', defeat: 'Defeat', broken: 'Defeat' },
    broken: (force: string): string => `${force} is broken.`,
    endPoints: (total: number, most: number, victory: number): string => `${total} campaign points of ${most} · victory at ${victory}`,
    cameThrough: (names: string): string => `Came through every battle: ${names}.`,
    cameHome: (n: number, of: number): string => `${n} of ${of} units came home.`,
    newCampaign: 'New Campaign',
    logHeading: (title: string): string => `Campaign Log · ${title}`,
    logNext: 'Next',
    logToCome: 'To come',
    logLost: (names: string): string => `Lost: ${names}`,
    logBought: (items: string): string => `Replaced: ${items}`,
    none: 'none',
    close: 'Close',
  },
  side: {
    heading: 'Choose Your Side',
    /** The select buttons: the first page is the German side's, the second the Soviet side's. */
    select: ['Select Germany', 'Select Soviet Union'],
    start: 'Start Battle',
    back: 'Back',
  },
  /** Multiplayer: a game played online, by a link for each side (side-screen.ts). */
  online: {
    /** The wide tag, before the game is made, while it is being made, once it is made, and on an invitation. */
    create: 'Create Game',
    creating: 'Creating…',
    open: 'Open Game',
    join: 'Join Game',
    /** The side selector's heading on an invitation. */
    invited: 'You Are Invited',
    link: 'Invitation link',
    copy: 'Copy Link',
    copied: 'Link copied.',
    notCopied: 'Select the link and copy it.',
    made: 'Send this link to your opponent, then open your game.',
    choose: 'Choose your side, then create the game.',
    yourSide: 'You play the side shown. Press Join Game.',
    /** On an invitation, once the scenario is known: its name and the side the player plays. */
    invitedTo: (scenario: string, side: string): string => `${scenario}: you play the ${side}. Press Join Game.`,
    locked: 'The invitation sets your side.',
    gone: 'This game no longer exists.',
    unreachable: 'The game server could not be reached.',
  },
  /** The rewards after a battle and the service record (rewards-screen.ts); the outcomes', medals' and ranks' names are in content/rewards/rewards.yaml. */
  rewards: {
    label: 'Battle rewards',
    recordLabel: 'Service record',
    /** The clipboard's headline: the outcome's words (rewards.yaml) after these; the shorter lead-in goes with a two-word outcome. */
    outcomeLine: (outcome: string, long: boolean): string => `${long ? 'Outcome' : 'Battle Outcome'}: ${outcome}`,
    /** The battle's name and the level it was played at. */
    battleLine: (title: string, level: string): string => `${title} - ${level}`,
    levels: { patrol: 'Patrol', skirmish: 'Skirmish', battle: 'Battle', offensive: 'Offensive', campaign: 'Campaign' } as Readonly<Record<string, string>>,
    enemyDestroyed: 'Enemy destroyed',
    yourLosses: 'Your losses',
    objectives: 'Objectives held',
    ofAll: (n: number, of: number): string => `${n} of ${of}`,
    score: 'Score',
    /** The player's score, then the enemy's. */
    scoreLine: (mine: number, theirs: number): string => `${mine} to ${theirs}`,
    gained: (n: number): string => `${n > 0 ? '+' : ''}${n} ${n === 1 ? 'pt' : 'pts'}`,
    campaignPoints: 'Campaign points',
    servicePoints: 'Service points',
    /** Our own stamps: the words round the ring stamp (the outcome is across its middle), and the two boxed ones. */
    stampOver: 'Battle Report',
    stampUnder: GAME.name,
    confirmed: 'Confirmed',
    recorded: 'Recorded',
    noMedal: 'No medal',
    noMedalWhy: 'No medal this time.',
    /** The right page's heading: after a promotion, and after a battle without one. */
    promotionHead: 'Promotion & Honors',
    rankHonors: 'Rank & Honors',
    newRank: 'New rank:',
    rankLabel: 'Rank:',
    rankHead: 'Rank',
    promotedFrom: (name: string): string => `Promoted from ${name}.`,
    toNext: (more: number, next: string): string => `${more} more ${more === 1 ? 'point' : 'points'} to ${next}.`,
    highest: 'The highest rank.',
    /** How many of a medal the record holds. */
    times: (n: number): string => `x ${n}`,
    serviceRecord: 'Service Record',
    /** The same on its small plate, one word over the other. */
    recordPlate: ['Service', 'Record'] as readonly [string, string],
    /** The record's own citation: what the rank was earned by. */
    recordNote: (won: number, medals: number): string => `${won} ${won === 1 ? 'victory' : 'victories'} and ${medals} ${medals === 1 ? 'medal' : 'medals'} so far.`,
    continue: 'Continue',
    again: 'Play Again',
    mainMenu: 'Main Menu',
    back: 'Back',
    recordSide: (name: string): string => `${name} side`,
    fought: 'Battles fought',
    won: 'Won',
    lost: 'Lost',
    medals: 'Medals',
    showSide: (name: string): string => `${name} Record`,
  },
} as const;
