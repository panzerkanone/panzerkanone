/**
 * The pieces' shaders: a counter (its printed face, its cut edge, its plain
 * back), the shadows counters lay on the boards and the table, the glow under
 * a marked counter, the strokes of the game's cues (a line of fire, a route, a
 * tag and its letters), and a marker lying on a hex.
 *
 * They take the table's light as the board does (the scene's shared uniforms
 * and `finish`): a face lying flat is its print times exactly 1 plus a little
 * sheen; the cut edge is matte. There is no shadow map (ruling 4): every
 * shadow is computed from the counters' own shapes. A caster is a rounded
 * square between two heights, turned about the vertical; its shadow at a point
 * is where the ray toward the key light passes through it, soft in proportion
 * to the height climbed, so that a counter lying on the surface has a tight
 * dark line round it and a lifted one a wider, softer patch.
 *
 * The ground cannot be told what stands on it (its shaders are the board's
 * own), so the shadows on it are drawn over it: the plan is cut into cells,
 * each cell that a counter's shadow can reach is one quad with the list of
 * those counters, and its shader multiplies the ground by the light that is
 * left. One quad a cell, never one a counter: where two shadows overlap the
 * ground is darkened once, not twice.
 */
import { COMMON } from '../shaders';
import { TRAY_SHADE } from '../tray/shade';

/** How many casters a cell of the ground lists, and a counter. */
export const CELL_CASTERS = 16;
export const COUNTER_CASTERS = 8;

/** The shadow of the listed casters at a point. (Exported for the tray's shader: the counters in its wells shadow it.) */
export const CAST = /* glsl */ `
uniform highp sampler2D uCasters;  // a row a caster: (centre x, y, foot z, top z), (cos, sin of its turn, half size x, y)
uniform vec4 uCounter;             // half a counter's side, its corner radius, the penumbra's slope, the contact line's width

const float AO_REACH = 0.11;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/** One caster at a point P: what it leaves of the key (lit), how much of the room it hides (occ), how near its foot is (contact). */
void castOne(int idx, vec3 P, float pix, inout float lit, inout float occ, inout float contact) {
  vec4 a = texelFetch(uCasters, ivec2(0, idx), 0);
  if (a.w <= P.z + 0.004) return;
  vec4 b = texelFetch(uCasters, ivec2(1, idx), 0);
  vec2 d = P.xy - a.xy;
  vec2 lp = vec2(b.x * d.x + b.y * d.y, b.x * d.y - b.y * d.x);
  vec2 lh = uKeyDir.xy / uKeyDir.z;
  vec2 ll = vec2(b.x * lh.x + b.y * lh.y, b.x * lh.y - b.y * lh.x);
  float hA = max(a.z - P.z, 0.0);
  float hB = a.w - P.z;
  vec2 hs = b.zw;
  float rad = uCounter.y * min(hs.x, hs.y) / uCounter.x;
  vec2 qd = abs(lp) - hs;
  // Too far for its shadow at this height, or for what it hides of the room, to arrive.
  if (max(qd.x, qd.y) > max(AO_REACH, length(lh) * hB * (1.0 + 1.5 * uCounter.z))) return;
  // The ray toward the key crosses the caster's heights along p0 .. p0 + v on the plan.
  vec2 p0 = lp + ll * hA;
  vec2 v = ll * (hB - hA);
  float vv = max(dot(v, v), 1e-9);
  float t1 = clamp(-dot(p0, v) / vv, 0.0, 1.0);
  vec2 cnr = sign(p0 + v * t1) * (hs - rad);
  float t2 = clamp(dot(cnr - p0, v) / vv, 0.0, 1.0);
  // Tested at its foot, its top and the two points of the track nearest the footprint; a caster
  // taller than a counter and a half (a counter in the air above the point) at its middle too.
  float sh = 0.0;
  int n = hB - hA > 0.15 ? 5 : 4;
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    float t = i == 0 ? 0.0 : (i == 1 ? 1.0 : (i == 2 ? t1 : (i == 3 ? t2 : 0.5)));
    float h = mix(hA, hB, t);
    float sd = sdRound(p0 + v * t, hs, rad);
    float w = max(h * uCounter.z, pix);
    sh = max(sh, 1.0 - smoothstep(-w, w, sd));
  }
  lit = min(lit, 1.0 - sh);
  // What its wall hides of the room, and the tight line where it meets the surface.
  float sd0 = sdRound(lp, hs, rad);
  if (sd0 > AO_REACH) return;
  float dd = max(sd0, 0.0);
  float c0 = hA < 0.012 ? 1.0 : dd / sqrt(dd * dd + hA * hA);
  float c1 = dd / sqrt(dd * dd + hB * hB);
  float F = 0.5 * (c0 - c1) * (1.0 - smoothstep(0.35 * AO_REACH, AO_REACH, dd));
  if (sd0 < 0.0 && hA >= 0.012) F = max(F, 0.5 * (-sd0) / sqrt(sd0 * sd0 + hA * hA));
  occ += F;
  if (hA < 0.012) contact = max(contact, exp(-dd / uCounter.w));
}
`;

/** A counter: the die-cut square, placed and turned by its instance. */
export const COUNTER_VERTEX = /* glsl */ `
attribute vec3 aPart;     // distance along the outline; height on the wall, 0 at the foot to 1; 0 printed face, 1 wall, 2 back
attribute vec4 aPlace;    // its centre, and how large it is drawn (1, except on its way on or off the table)
attribute vec4 aTurn;     // its turn, a unit quaternion
attribute vec4 aInfo;     // its face's cell in the atlas (column, row); a number of its own; the left edge of its group's tab as a share of the face (0: no tab)
attribute vec4 aMarks;    // selected, hover, target, may act
attribute vec4 aMarksB;   // spent, suppressed, lit (one of the group in hand, no group mark), how high its pulse stands
attribute vec4 aMarksC;   // a close attack's red glow (above 1 at the height of its swell); how high the swells of a counter just chosen stand; unused; unused
attribute vec4 aNotes;    // its group is acting, it has been seen, a click would choose it; its stock and Moved: 1 + moved on the first stock, -(1 + moved) on the second
attribute vec4 aOccA;     // the casters that may shadow it (rows of the caster table; -1 none)
attribute vec4 aOccB;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPart;
varying vec3 vLocal;
flat varying vec4 vInfo;
flat varying vec4 vMarks;
flat varying vec4 vMarksB;
flat varying vec4 vMarksC;
flat varying vec4 vNotes;
flat varying vec4 vOccA;
flat varying vec4 vOccB;

vec3 turned3(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 p = turned3(aTurn, position * aPlace.w) + aPlace.xyz;
  vPos = p;
  vNormal = turned3(aTurn, normal);
  vUv = uv;
  vPart = aPart;
  vLocal = position;
  vInfo = aInfo;
  vMarks = aMarks;
  vMarksB = aMarksB;
  vMarksC = aMarksC;
  vNotes = aNotes;
  vOccA = aOccA;
  vOccB = aOccB;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const COUNTER_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPart;
varying vec3 vLocal;
flat varying vec4 vInfo;
flat varying vec4 vMarks;
flat varying vec4 vMarksB;
flat varying vec4 vMarksC;
flat varying vec4 vNotes;
flat varying vec4 vOccA;
flat varying vec4 vOccB;
${COMMON}
${CAST}
${TRAY_SHADE}
uniform sampler2D uAtlas;
uniform vec4 uAtlasGrid;   // cells across, cells down, the share of a cell that is only stock on each side, the faces' gloss
uniform sampler2D uSurface;
uniform vec4 uSheen;
uniform vec4 uSheenB;
uniform vec3 uWinDir;
uniform vec3 uCore;        // the card's core, seen at the cut edge
uniform vec3 uBack;        // the plain back
uniform vec4 uCard;        // the board's light back onto a wall; how dark the foot of a wall is; unused; unused
uniform vec3 uInkSelected;
uniform vec3 uInkHover;
uniform vec3 uInkTarget;
uniform vec3 uInkCanAct;
uniform vec3 uInkSuppressed;
uniform vec3 uInkPick;
uniform vec3 uInkRevealed;
uniform vec3 uInkMoved;
uniform vec4 uMoved;       // the Moved chevron: its middle (shares of the face, across and down), its half height, its stroke's half width
uniform vec3 uInkClose;    // a close attack's red glow
uniform vec4 uClose;       // the band of the edge that glows (h in from it), its strength, the wash over the face; unused
uniform vec3 uInkChosen;   // the chosen counter's outline
uniform vec4 uChosen;      // the line on its face just inside the edge (half width, h), its cut edge's light, whether the outline is drawn, how much brighter at the height of a swell
uniform vec4 uSpent;       // Spent: how far toward grey, how dark that grey; its cut edge's and its sheen's share
uniform vec4 uSpentB;      // the foot of the band (share of the face, from the top), whether the band is darkened; unused; unused
uniform vec4 uTab;         // a group's tab on a face: its right edge, its top, its foot (shares of the face); how much it grows while its group acts
uniform vec3 uTabInks[8];  // for each stock (four each, linear): the band's colour and its ink, as printed in the tab; what each is printed as while the group acts
uniform vec3 uInkLit;      // the light of a counter of the group in hand
uniform vec4 uLitRim;      // that light on the counter's own edge: its strength, how far in from the edge it reaches on the face (h), its share on the cut edge, how much stronger at the height of its pulse

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vPos);
  float part = vPart.z;
  bool face = part < 0.5;
  bool back = part > 1.5;
  // How far inside the die-cut outline this point of a face is, in h.
  float inside = -sdRound(vLocal.xy, vec2(uCounter.x), uCounter.y);
  float pixH = max(length(fwidth(vPos)), 1e-5);
  vec2 cell = vInfo.xy;
  vec3 stock = textureLod(uAtlas, (cell + vec2(0.5, 0.012)) / uAtlasGrid.xy, 2.0).rgb;
  vec4 grain = texture2D(uNoise, vLocal.xy * 1.7 + vInfo.z * vec2(7.3, 3.1));

  vec3 albedo;
  if (face) {
    vec2 fuv = clamp(vUv, 0.0, 1.0);
    vec2 st = (cell + uAtlasGrid.z + fuv * (1.0 - 2.0 * uAtlasGrid.z)) / uAtlasGrid.xy;
    albedo = texture2D(uAtlas, st).rgb;
    // The tab of a group that is acting is drawn a little larger (the print is read nearer the tab's
    // middle), and its two inks are printed as two others (uTabInks): the other way round, a solid
    // block in the band with the characters cut out of it. Only such a counter pays for it.
    if (vInfo.w > 0.0 && vNotes.x > 0.002) {
      vec2 mid = vec2(0.5 * (vInfo.w + uTab.x), 0.5 * (uTab.y + uTab.z));
      vec2 hs = vec2(0.5 * (uTab.x - vInfo.w), 0.5 * (uTab.z - uTab.y));
      vec2 q = (fuv - mid) / (1.0 + uTab.w * vNotes.x);
      vec2 stDx = dFdx(st);
      vec2 stDy = dFdy(st);
      if (abs(q.x) < hs.x && abs(q.y) < hs.y) {
        vec2 stTab = (cell + uAtlasGrid.z + (mid + q) * (1.0 - 2.0 * uAtlasGrid.z)) / uAtlasGrid.xy;
        vec3 tab = textureGrad(uAtlas, stTab, stDx, stDy).rgb;
        int k = vNotes.w < 0.0 ? 4 : 0;
        vec3 band = uTabInks[k];
        vec3 d = uTabInks[k + 1] - band;
        float t = clamp(dot(tab - band, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
        albedo = mix(tab, mix(uTabInks[k + 2], uTabInks[k + 3], t), vNotes.x);
      }
    }
    // Suppressed: a sash across the face (and the counter lies turned).
    float sash = 1.0 - smoothstep(0.075, 0.075 + 1.5 * pixH, abs(vLocal.x + vLocal.y) * 0.7071);
    albedo = mix(albedo, uInkSuppressed, 0.78 * sash * vMarksB.y);
    // Spent: greyed and darker (by its treatment); in one of them its band, the face's brightest part, goes dark too.
    float grey = dot(albedo, vec3(0.3, 0.59, 0.11));
    albedo = mix(albedo, vec3(grey) * uSpent.y, uSpent.x * vMarksB.x);
    if (uSpentB.y > 0.5 && vMarksB.x > 0.002) {
      float band = 1.0 - smoothstep(uSpentB.x - 0.004, uSpentB.x + 0.004, fuv.y);
      albedo = mix(albedo, vec3(0.055, 0.05, 0.045) + 0.12 * albedo, 0.82 * band * vMarksB.x);
    }
    // The print is thin on the pressed edge the die leaves.
    albedo = mix(albedo, stock * 1.08, 0.35 * (1.0 - smoothstep(0.0, 0.014, inside)));
  } else if (back) {
    albedo = uBack * (0.93 + 0.14 * grain.r) * (1.0 - 0.05 * grain.b);
  } else {
    // The cut edge: the face's paper at the top, the back's at the foot, and between them the grey
    // core, laid in layers and a little torn by the die.
    float h = vPart.y;
    vec4 nf = texture2D(uNoise, vec2(vPart.x * 2.3 + vInfo.z * 9.0, h * 0.5 + vInfo.z * 5.0));
    vec4 ng = texture2D(uNoise, vec2(vPart.x * 9.0 + vInfo.z * 3.0, h * 0.21));
    vec3 core = uCore * (0.8 + 0.42 * nf.r) * (1.0 - 0.16 * smoothstep(0.55, 0.8, ng.g));
    core *= 0.93 + 0.14 * sin(h * 19.0 + nf.b * 6.0);
    float top = smoothstep(0.84, 0.9, h + 0.05 * (ng.r - 0.5));
    float foot = 1.0 - smoothstep(0.07, 0.13, h + 0.05 * (ng.b - 0.5));
    albedo = mix(core, stock * 0.92, top);
    albedo = mix(albedo, uBack * 0.9, foot);
    albedo *= mix(1.0, uSpent.z, vMarksB.x);
  }

  // ---- the light ---------------------------------------------------------------------------------
  float lit = 1.0;
  float occ = 0.0;
  float contact = 0.0;
  if (uLight.y > 0.5) {
    for (int k = 0; k < 8; k++) {
      float f = k < 4 ? vOccA[k] : vOccB[k - 4];
      if (f < 0.0) break;
      castOne(int(f + 0.5), vPos, 0.75 * pixH + 0.0005, lit, occ, contact);
    }
    // Lying in a well of the tray, it is shaded by the walls round it (shade.ts); anywhere else this is 1 and 0.
    float under;
    lit = min(lit, trayKey(vPos, under));
    occ += uTrayC.y * smoothstep(0.0, uTrayC.z, under);
  }
  float ao = clamp(1.0 - occ, 0.25, 1.0);
  float wall = (face || back) ? 0.0 : 1.0;
  vec3 light;
  if (uLight.z > 0.5) {
    float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
    // The room's light by the face's direction (the room's own, rooms.ts; without one the old sky).
    vec3 sky = roomLight(N);
    // A wall has the surface under it for half its view: it takes a little of that surface's light.
    light = uLight.x * key * lit + (1.0 - uLight.x) * sky * ao * (1.0 + 0.15 * wall) + uCard.x * (1.0 - N.z) * (0.4 + 0.6 * lit) * ao;
  } else {
    light = vec3((0.74 + 0.26 * N.z) * (0.72 + 0.28 * lit));
  }
  // The foot of a wall stands in the crevice it makes with what it lies on.
  light *= 1.0 - wall * uCard.y * (1.0 - smoothstep(0.0, 0.45, vPart.y));
  light *= 1.0 - 0.3 * contact * (1.0 - wall);
  vec3 col = albedo * light * lampPool(vPos);

  // ---- the printed face is a little shiny; the cut edge and the back are not -----------------------
  if (face && uLight.z > 0.5) {
    // A little of the paper's fibre turns the sheen, as on the sheet (uPaper.y; none where the table has no uPaper).
    vec3 R = reflect(-V, normalize(N - 0.7 * uPaper.y * vec3(slopeOf(uSurface, vLocal.xy * 0.6 + vInfo.z * vec2(3.7, 9.1), 1.0 / 512.0, vec4(0.6, 0.4, 0.0, 0.0)), 0.0)));
    float nv = clamp(dot(N, V), 0.0, 1.0);
    float fres = uSheen.z + (1.0 - uSheen.z) * pow(1.0 - nv, uSheen.w);
    float key = exp(-uSheenB.x * (1.0 - dot(R, uKeyDir))) * lit;
    float win = exp(-uSheenB.y * (1.0 - dot(R, uWinDir)));
    // The paper's tooth breaks the highlight up a little; the fibre's weave is left out (at a counter's
    // size it reads as a pattern printed on the face).
    vec4 sa = texture2D(uSurface, vLocal.xy * 0.6 + vInfo.z * vec2(3.7, 9.1));
    float tooth = max(0.0, 1.0 + 0.45 * (sa.r - 0.5));
    // The lamp over the table (lights.ts: uRig.z of it; none in today's light), as the sheet shows it.
    float lamp = uRig.z * uLamp.w * (1.0 + uLampB.w * pow(1.0 - nv, uSheen.w)) * exp(-uLampB.x * (1.0 - dot(R, normalize(uLamp.xyz - vPos))));
    col += (fres * (uSheen.x * key + uSheen.y * win) + lamp) * tooth * uAtlasGrid.w * (1.0 + uRig.w) * mix(vec3(1.0), albedo, uSheenB.z) * vec3(1.0, 0.975, 0.93) * mix(1.0, uSpent.w, vMarksB.x);
    // The room in the printed face (rooms.ts), by the face's roughness; as the sheet, never more than uRoomC.z of white.
    if (uRoom.x > 0.5) col += min(roomRadiance(R, uRoomC.y) * roomBRDF(vec3(0.04), uRoomC.y, nv) * tooth, vec3(uRoomC.z)) * mix(vec3(1.0), albedo, uSheenB.z) * mix(1.0, uSpent.w, vMarksB.x);
  }

  // ---- marks: light from the counter itself, most at its rim -----------------------------------------
  float rim = wall > 0.5 ? 0.7 : 1.0 - smoothstep(0.0, 0.06, inside);
  vec3 glow = uInkSelected * vMarks.x * 0.85 + uInkHover * vMarks.y * 0.3 + uInkTarget * vMarks.z * 0.8;
  col += glow * rim * (back ? 0.0 : 1.0);
  // A close attack a click would make on it: its edge glows red in a wider band, and a faint red wash lies over its face.
  if (vMarksC.x > 0.002 && !back) {
    float band = wall > 0.5 ? 0.85 : 1.0 - smoothstep(0.0, uClose.x, inside);
    col += uInkClose * vMarksC.x * (uClose.y * band * band + uClose.z);
  }
  // The chosen counter's outline: a crisp bright line just inside its edge, and its cut edge lit, brighter at a swell.
  if (uChosen.z > 0.5 && vMarks.x > 0.002 && !back) {
    float line = wall > 0.5 ? uChosen.y : 1.0 - smoothstep(2.0 * uChosen.x, 2.0 * uChosen.x + 1.5 * pixH, inside);
    col = mix(col, uInkChosen * (1.0 + uChosen.w * vMarksC.y), min(1.0, 0.9 * line * vMarks.x));
  }
  // One of the group in hand: its edge catches the light that lies round it. A narrow line at the very edge of the
  // face, short of every number and of the may-act line, and a little on the cut edge; nothing on the print.
  if (vMarksB.z > 0.002 && !back) {
    float edge = wall > 0.5 ? uLitRim.z : 1.0 - smoothstep(0.0, uLitRim.y, inside);
    col += uInkLit * (uLitRim.x * vMarksB.z * (1.0 + uLitRim.w * vMarksB.w)) * edge;
  }
  // May act: a thin bright line just inside the edge.
  float line = (1.0 - smoothstep(0.0, 1.5 * pixH, abs(inside - 0.042) - 0.009)) * (face ? 1.0 : 0.0);
  col = mix(col, uInkCanAct, 0.75 * line * vMarks.w);
  // A click would choose it: a cool broken line where the may-act line runs, the same on every side.
  if (face && vNotes.z > 0.002) {
    float run = abs(abs(vLocal.x) > abs(vLocal.y) ? vLocal.y : vLocal.x);
    float dash = step(0.5, fract(run / 0.137 + 0.25));
    float cool = 1.0 - smoothstep(0.0, 1.5 * pixH, abs(inside - 0.042) - 0.014);
    col = mix(col, uInkPick, 0.92 * cool * dash * vNotes.z);
  }
  // It has been seen: a bracket at each corner of the face, as in a viewfinder.
  if (face && vNotes.y > 0.002) {
    float corner = step(uCounter.x - 0.17, min(abs(vLocal.x), abs(vLocal.y)));
    float seen = 1.0 - smoothstep(0.0, 1.5 * pixH, abs(inside - 0.045) - 0.008);
    col = mix(col, uInkRevealed, 0.85 * seen * corner * vNotes.y);
  }
  // It has moved and can still do one thing more: a small chevron pointing on, ">", at the face's lower right, in the free
  // stock between how far it moves and its foot (MOVED_MARK).
  float moved = abs(vNotes.w) - 1.0;
  if (face && moved > 0.002) {
    vec2 q = (clamp(vUv, 0.0, 1.0) - uMoved.xy) / uMoved.z;
    float px = max(fwidth(q.x), 1e-4);
    float arm = abs(q.x + abs(q.y) - 0.5) * 0.7071;
    float w = uMoved.w / uMoved.z;
    float on = (1.0 - smoothstep(w - px, w + px, arm)) * (1.0 - smoothstep(1.0 - px, 1.0 + px, abs(q.y)));
    col = mix(col, uInkMoved, 0.92 * on * moved);
  }
  gl_FragColor = finish(col);
}
`;

/** The ground under the counters, cell by cell. */
export const GROUND_VERTEX = /* glsl */ `
attribute vec4 aCell;    // its corner (x, y), its side, the height of the surface it lies on
attribute vec4 aListA;
attribute vec4 aListB;
attribute vec4 aListC;
attribute vec4 aListD;
varying vec3 vPos;
flat varying vec4 vListA;
flat varying vec4 vListB;
flat varying vec4 vListC;
flat varying vec4 vListD;
void main() {
  vec3 p = vec3(aCell.xy + position.xy * aCell.z, aCell.w);
  vPos = p;
  vListA = aListA;
  vListB = aListB;
  vListC = aListC;
  vListD = aListD;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const GROUND_FRAGMENT = /* glsl */ `
varying vec3 vPos;
flat varying vec4 vListA;
flat varying vec4 vListB;
flat varying vec4 vListC;
flat varying vec4 vListD;
${COMMON}
${CAST}
uniform vec4 uGround;   // the table's height; how dark a shadow may be; unused; unused

void main() {
  vec3 P = vPos;
  // A cell on the boards' plane stops at the boards' edges; one on the table's is hidden under them.
  if (P.z > uGround.x + 0.5 * uShape.w) {
    float sd = uMount.w > 0.5 ? min(rrect(P.xy, uBoards[0], uShape.x), min(rrect(P.xy, uBoards[1], uShape.x), rrect(P.xy, uBoards[2], uShape.x))) : outlineDistance(P.xy);
    if (sd > 0.0) discard;
  }
  if (uLight.y < 0.5) discard;
  float pix = 0.75 * length(fwidth(P.xy)) + 0.0005;
  float lit = 1.0;
  float occ = 0.0;
  float contact = 0.0;
  for (int k = 0; k < 16; k++) {
    float f = k < 4 ? vListA[k] : (k < 8 ? vListB[k - 4] : (k < 12 ? vListC[k - 8] : vListD[k - 12]));
    if (f < 0.0) break;
    castOne(int(f + 0.5), P, pix, lit, occ, contact);
  }
  float ao = clamp(1.0 - occ, 0.2, 1.0);
  float share = uLight.x;
  float light = share * lit * (1.0 - 0.3 * (1.0 - ao)) + (1.0 - share) * ao;
  light *= 1.0 - 0.32 * contact;
  light = mix(1.0, light, uGround.y);
  // Where nothing is taken from the light nothing is written.
  if (light > 0.996) discard;
  // The frame holds values already on the screen's curve: a share of the light is that share's root there.
  gl_FragColor = vec4(vec3(pow(clamp(light, 0.0, 1.0), 1.0 / 2.2)), 1.0);
}
`;

/**
 * Light on the surface round a counter, in one of two kinds. The glow of a marked counter (selected, pointed at, a
 * target): tight against its edge, and added to what is there. The pool round a counter of the group in hand: soft
 * and wide (wider still at the height of its pulse), and laid over what is there as a wash of its own colour, because
 * light added to a pale sheet only whitens it: a wash warms pale ground and lightens dark ground alike. One mesh
 * draws both: what it writes is added, and the surface under it is kept less the wash's share.
 */
export const HALO_VERTEX = /* glsl */ `
attribute vec4 aHalo;    // the counter's centre on the plan, the height of the surface, its turn about the vertical
attribute vec4 aTint;    // a mark's glow: its colour at the counter's edge, and 0. A lit counter's pool: its strength at the counter's edge, unused, unused, and how many times its own reach it is wide (1 or more)
varying vec2 vAt;
flat varying vec4 vTint;
uniform vec4 uCounter;
uniform vec4 uLitPool;   // the light round a lit counter: how far its pool reaches from the counter's edge (h), the distance in which the pool falls away; how far off the edge the ring lies, and the ring's half width
uniform vec4 uChosenRing;
void main() {
  // A lit counter's pool; a wide glow (a close attack's, its reach told below -2); the chosen counter's outline (-1); a mark's glow.
  float reach = uCounter.x + (aTint.a > 0.5 ? uLitPool.x * aTint.a : aTint.a < -1.5 ? -aTint.a - 2.0 : aTint.a < -0.5 ? uChosenRing.x + uChosenRing.y + uChosenRing.z + 0.02 : 0.3);
  vec2 q = (position.xy * 2.0 - 1.0) * reach;
  float c = cos(aHalo.w);
  float s = sin(aHalo.w);
  vAt = q;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(aHalo.xy + vec2(c * q.x - s * q.y, s * q.x + c * q.y), aHalo.z, 1.0);
}
`;

export const HALO_FRAGMENT = /* glsl */ `
varying vec2 vAt;
flat varying vec4 vTint;
uniform vec4 uCounter;
uniform vec4 uLitPool;
uniform vec4 uLitRing;   // the wash's share at the middle of the ring, and of the pool at the counter's edge; unused; unused
uniform vec3 uInkLit;
uniform vec4 uChosenRing; // the chosen counter's outline: how far off its edge its middle lies, its half width; the keyline's width outside it, and how dark it is
void main() {
  vec2 q = abs(vAt) - vec2(uCounter.x) + uCounter.y;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCounter.y;
  float under = smoothstep(-0.06, 0.0, d);
  float px = max(fwidth(d), 1e-5);
  if (vTint.a < -1.5) {
    // A wide glow (a close attack's): strong at the counter's edge, falling away over its reach.
    float wide = -vTint.a - 2.0;
    float a = exp(-max(d, 0.0) / (0.34 * wide)) * under * (1.0 - smoothstep(0.55 * wide, wide, d));
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vTint.rgb * a, 0.0);
    return;
  }
  if (vTint.a < -0.5) {
    // The chosen counter's outline: a bright line just off its edge (light added), and outside it a dark keyline (the surface
    // kept less a share), so that it reads on pale ground as on dark.
    float line = 1.0 - smoothstep(uChosenRing.y - px, uChosenRing.y + px, abs(d - uChosenRing.x));
    float outer = uChosenRing.x + uChosenRing.y;
    float key = smoothstep(outer - px, outer + px, d) * (1.0 - smoothstep(outer + uChosenRing.z - px, outer + uChosenRing.z + px, d));
    float strength = clamp(max(vTint.r, max(vTint.g, vTint.b)), 0.0, 1.0);
    if (line <= 0.002 && key <= 0.002) discard;
    gl_FragColor = vec4(vTint.rgb * line, uChosenRing.w * key * strength);
    return;
  }
  if (vTint.a > 0.5) {
    // A soft ring a little way off the counter's edge, in a wider and fainter pool.
    float reach = uLitPool.x * vTint.a;
    float off = (d - uLitPool.z * vTint.a) / uLitPool.w;
    float m = min(0.85, vTint.r * (uLitRing.x * exp(-off * off) + uLitRing.y * exp(-max(d, 0.0) / (uLitPool.y * vTint.a)))) * under * (1.0 - smoothstep(0.5 * reach, reach, d));
    if (m <= 0.002) discard;
    gl_FragColor = vec4(uInkLit * m, m);
  } else {
    float a = exp(-max(d, 0.0) / 0.075) * under * (1.0 - smoothstep(0.2, 0.3, d));
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vTint.rgb * a, 0.0);
  }
}
`;

/**
 * A stroke: a rounded bar from one point to another, lying flat at a height. With a corner radius
 * of half its width it is a pen stroke; wider, with small corners, it is a card (a tag). It may be
 * broken into dashes, end in a pointed head, have a soft edge (a shadow), be broken up by the
 * sheet's tooth (grease pencil), and be one of a run: then it is cut where it meets its neighbours,
 * so that no point of the run is drawn twice.
 */
export const STROKE_VERTEX = /* glsl */ `
attribute vec4 aSeg;      // from (x, y), to (x, y)
attribute vec4 aShape;    // half its width, its corner radius, the height it lies at, the reach of a soft edge (0: sharp)
attribute vec4 aInk;      // its colour (linear), how solid it is
attribute vec4 aStyle;    // dash on, dash off (0: whole), the length of a pointed head at its far end (0: none), how much the sheet's tooth breaks it up
attribute vec4 aJoin;     // the way the stroke before it runs, and the one after it (0, 0: a free end)
varying vec2 vAt;         // along from its first end, across
varying vec2 vPlan;
flat varying float vLength;
flat varying vec4 vShape;
flat varying vec4 vInk;
flat varying vec4 vStyle;
flat varying vec4 vCut;   // the line it is cut along at its first end, and at its far end (each a unit vector, along and across)
void main() {
  vec2 d = aSeg.zw - aSeg.xy;
  float len = length(d);
  vec2 u = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float wide = max(aShape.x, aStyle.z > 0.0 ? 2.7 * aShape.x : 0.0) + aShape.w + 0.012;
  float past = aShape.x + aShape.w + 0.012;
  float along = mix(-past, len + past, position.x);
  float across = (position.y * 2.0 - 1.0) * wide;
  vAt = vec2(along, across);
  vLength = len;
  vShape = aShape;
  vInk = aInk;
  vStyle = aStyle;
  vec2 before = dot(aJoin.xy, aJoin.xy) > 0.25 ? normalize(vec2(dot(aJoin.xy, u), dot(aJoin.xy, n)) + vec2(1.0, 0.0)) : vec2(0.0);
  vec2 after = dot(aJoin.zw, aJoin.zw) > 0.25 ? normalize(vec2(dot(aJoin.zw, u), dot(aJoin.zw, n)) + vec2(1.0, 0.0)) : vec2(0.0);
  vCut = vec4(before, after);
  vec2 at = aSeg.xy + u * along + n * across;
  vPlan = at;
  gl_Position = projectionMatrix * viewMatrix * vec4(at, aShape.z, 1.0);
}
`;

export const STROKE_FRAGMENT = /* glsl */ `
varying vec2 vAt;
varying vec2 vPlan;
flat varying float vLength;
flat varying vec4 vShape;
flat varying vec4 vInk;
flat varying vec4 vStyle;
flat varying vec4 vCut;
${COMMON}
void main() {
  float hw = vShape.x;
  float rad = vShape.y;
  float px = max(length(fwidth(vAt)), 1e-5);
  float x = vAt.x;
  float y = vAt.y;
  // One of a run: it runs on past a joined end, and is cut along the line that halves the corner.
  bool joinA = dot(vCut.xy, vCut.xy) > 0.5;
  bool joinB = dot(vCut.zw, vCut.zw) > 0.5;
  if (joinA && dot(vec2(x, y), vCut.xy) < 0.0) discard;
  if (joinB && dot(vec2(x - vLength, y), vCut.zw) >= 0.0) discard;
  float head = vStyle.z;
  float x0 = joinA ? -1.0 : 0.0;
  float x1 = joinB ? vLength + 1.0 : (head > 0.0 ? vLength - 0.8 * head : vLength);
  float d;
  if (vStyle.x > 0.0) {
    // Dashes, each with round ends, counted from the first end; the last is cut short where the shaft ends.
    float period = vStyle.x + vStyle.y;
    float k = floor(x / period);
    d = 1e3;
    for (int i = 0; i < 2; i++) {
      float s = (k + float(i)) * period;
      float a = max(s + hw, 0.0);
      float b = min(s + vStyle.x - hw, x1);
      if (b >= a) d = min(d, length(vec2(x - clamp(x, a, b), y)) - hw);
    }
  } else {
    vec2 q = vec2(max(max(x0 - x, x - x1), 0.0), max(abs(y) - (hw - rad), 0.0));
    d = length(q) - rad;
  }
  if (head > 0.0) {
    float t = clamp((vLength - x) / head, 0.0, 1.0);
    d = min(d, max(abs(y) - 2.6 * hw * t, max(x - vLength, vLength - head - x)));
  }
  float a = vShape.w > 0.0 ? 1.0 - smoothstep(-vShape.w, vShape.w, d) : 1.0 - smoothstep(-px, px, d);
  if (vStyle.w > 0.0) {
    // Wax on paper: it takes on the tooth's high places and skips the low ones, most at the stroke's edges.
    float tooth = texture2D(uNoise, vPlan * 2.9).r * 0.6 + texture2D(uNoise, vPlan * 11.0 + 0.37).g * 0.4;
    float press = clamp(-d / hw, 0.0, 1.0);
    a *= mix(1.0, smoothstep(0.34, 0.62, tooth + 0.34 * press), vStyle.w);
  }
  a *= vInk.a;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(finish(vInk.rgb).rgb, a);
}
`;

/**
 * A marker: a hexagon of thin card lying on its hex, printed. It takes the table's light and the
 * shadows of the counters round it and on it as a counter's face does, and the board's tints of its
 * hex are laid over its print, so that it hides none of them.
 */
export const MARKER_VERTEX = /* glsl */ `
attribute vec3 aPart;     // how far in from the rim, 0 at the rim to 1 at the middle; height on the wall, 0 at the foot to 1; 0 the printed face, 1 the wall
attribute vec4 aPlace;    // its centre, and how large it is drawn
attribute vec4 aTurn;     // cos and sin of its turn about the vertical; its print's cell in the atlas (column, row)
attribute vec4 aHex;      // its hex's column and row; a number of its own; unused
attribute vec4 aOccA;     // the casters that may shadow it (rows of the caster table; -1 none)
attribute vec4 aOccB;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPart;
flat varying vec4 vTurn;
flat varying vec4 vHex;
flat varying vec4 vOccA;
flat varying vec4 vOccB;
uniform vec4 uMarker;     // the shadow's reach, its strength, how far it is thrown along the plan (x, y)
void main() {
  vec3 q = position * aPlace.w;
  vec3 p = vec3(aTurn.x * q.x - aTurn.y * q.y, aTurn.y * q.x + aTurn.x * q.y, q.z) + aPlace.xyz;
  vPos = p;
  vNormal = vec3(aTurn.x * normal.x - aTurn.y * normal.y, aTurn.y * normal.x + aTurn.x * normal.y, normal.z);
  vUv = uv;
  vPart = aPart;
  vTurn = aTurn;
  vHex = aHex;
  vOccA = aOccA;
  vOccB = aOccB;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const MARKER_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vPart;
flat varying vec4 vTurn;
flat varying vec4 vHex;
flat varying vec4 vOccA;
flat varying vec4 vOccB;
${COMMON}
${CAST}
uniform sampler2D uMarkerAtlas;
uniform vec4 uMarkerGrid;   // cells across, cells down, the print's gloss, unused
uniform sampler2D uHexTints;
uniform sampler2D uHexTintsB;
uniform vec3 uTintInk[8];
uniform vec4 uOverlay;
uniform vec4 uSheen;
uniform vec4 uSheenB;
uniform vec3 uWinDir;
uniform vec3 uCore;
uniform vec4 uCard;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vPos);
  bool face = vPart.z < 0.5;
  float pixH = max(length(fwidth(vPos)), 1e-5);
  vec3 print = texture2D(uMarkerAtlas, (vTurn.zw + clamp(vUv, 0.0, 1.0)) / uMarkerGrid.xy).rgb;
  vec4 grain = texture2D(uNoise, vec2(vUv.x * 5.0 + vHex.z * 9.0, vUv.y * 5.0 + vPart.y * 0.4 + vHex.z * 5.0));
  vec3 albedo;
  if (face) {
    albedo = print;
    // The board's tints of this hex, laid over the print as they are laid over the map.
    if (uOverlay.w > 0.5) {
      ivec2 cell = ivec2(vHex.xy + 0.5);
      vec4 t = texelFetch(uHexTints, cell, 0) * uOverlay.x;
      albedo *= mix(vec3(1.0), uTintInk[0], t.r);
      albedo *= mix(vec3(1.0), uTintInk[1], t.g);
      albedo *= mix(vec3(1.0), uTintInk[2], t.b);
      albedo *= mix(vec3(1.0), uTintInk[3], t.a);
      vec4 tb = texelFetch(uHexTintsB, cell, 0) * uOverlay.x;
      albedo *= mix(vec3(1.0), uTintInk[4], tb.r);
      albedo *= mix(vec3(1.0), uTintInk[5], tb.g);
      albedo *= mix(vec3(1.0), uTintInk[6], tb.b);
      albedo *= mix(vec3(1.0), uTintInk[7], tb.a);
    }
    // The print is thin at the cut.
    albedo = mix(albedo, albedo * 0.5 + 0.5 * uCore * 1.5, 0.3 * (1.0 - smoothstep(0.0, 0.035, vPart.x)));
  } else {
    albedo = uCore * (0.82 + 0.4 * grain.r);
  }
  float lit = 1.0;
  float occ = 0.0;
  float contact = 0.0;
  if (uLight.y > 0.5) {
    for (int k = 0; k < 8; k++) {
      float f = k < 4 ? vOccA[k] : vOccB[k - 4];
      if (f < 0.0) break;
      castOne(int(f + 0.5), vPos, 0.75 * pixH + 0.0005, lit, occ, contact);
    }
  }
  float ao = clamp(1.0 - occ, 0.25, 1.0);
  float wall = face ? 0.0 : 1.0;
  float light;
  if (uLight.z > 0.5) {
    float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
    float sky = 0.5 + 0.5 * N.z;
    light = uLight.x * key * lit + (1.0 - uLight.x) * sky * ao + uCard.x * (1.0 - N.z) * (0.4 + 0.6 * lit) * ao;
  } else {
    light = (0.74 + 0.26 * N.z) * (0.72 + 0.28 * lit);
  }
  light *= 1.0 - 0.3 * contact * (1.0 - wall);
  vec3 col = albedo * light;
  if (face && uLight.z > 0.5) {
    vec3 R = reflect(-V, N);
    float nv = clamp(dot(N, V), 0.0, 1.0);
    float fres = uSheen.z + (1.0 - uSheen.z) * pow(1.0 - nv, uSheen.w);
    float key = exp(-uSheenB.x * (1.0 - dot(R, uKeyDir))) * lit;
    float win = exp(-uSheenB.y * (1.0 - dot(R, uWinDir)));
    col += fres * (uSheen.x * key + uSheen.y * win) * (0.8 + 0.4 * grain.g) * uMarkerGrid.z * mix(vec3(1.0), albedo, uSheenB.z) * vec3(1.0, 0.975, 0.93);
  }
  gl_FragColor = finish(col);
}
`;

/** The shadow a marker lays on the sheet: its own outline, a little larger and thrown away from the key, soft. */
export const MARKER_SHADOW_VERTEX = /* glsl */ `
attribute vec3 aPart;
attribute vec4 aPlace;
attribute vec4 aTurn;
varying float vIn;
flat varying float vSize;
uniform vec4 uMarker;
uniform vec4 uMarkerB;    // the height the shadow is drawn at; a marker's half size (middle to a side); unused; unused
void main() {
  float grow = (uMarkerB.y + uMarker.x) / uMarkerB.y;
  vec2 q = position.xy * aPlace.w * grow;
  vec2 p = vec2(aTurn.x * q.x - aTurn.y * q.y, aTurn.y * q.x + aTurn.x * q.y) + aPlace.xy + uMarker.zw * aPlace.w;
  vIn = aPart.x * (uMarkerB.y + uMarker.x);
  vSize = aPlace.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, uMarkerB.x, 1.0);
}
`;

export const MARKER_SHADOW_FRAGMENT = /* glsl */ `
varying float vIn;
flat varying float vSize;
uniform vec4 uMarker;
void main() {
  float a = uMarker.y * smoothstep(0.0, 2.0 * uMarker.x, vIn) * smoothstep(0.2, 0.9, vSize);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;
