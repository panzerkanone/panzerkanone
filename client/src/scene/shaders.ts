/**
 * The scene's shaders. Four surfaces: a board's top (the printed sheet: the
 * baked art, the grid ink overlay, how the paper takes the light; and round it
 * the covering paper of the mounted board), a board's edge, the table top, and
 * a load for the stress setting.
 *
 * Every position is in the board frame (x right, y down the board, z up, in h):
 * the meshes are built in it and the camera's matrices take it straight to the
 * screen. No shadow map and no screen pass: the boards' shadows on the table,
 * and on each other's walls in a joint, are computed from their rectangles
 * (rulings 4 and 32), and the grade and the vignette are the last multiply of
 * every surface's own shader (ruling 14).
 *
 * Two materials (ruling 32 (j)). The sheet is the only thing with a sheen: its
 * highlight, scratches and tooth are added light, clipped at the sheet's edge.
 * Three things show in it: the key and a window, which are far off and so keep
 * their place in the frame, and the lamp over the table (ruling 36), which is
 * near: its soft reflection lies between the eye and the lamp and slides over
 * the sheet as the view moves.
 * The wrap is matte: `wrapLight` has a diffuse key and the room and no
 * reflection term at all, so no angle can raise a highlight on it; its tooth
 * and its folds turn that diffuse light and nothing else.
 *
 * `uMount.w` chooses the construction: 1 the mounted boards, 0 the former one
 * (one outline printed to its edge, a groove at each seam), kept for comparison.
 *
 * No hex fact is written here: the grid reaches the board shader as uniforms
 * computed from engine/core/hex.ts (see grid.ts).
 */

/** Board frame straight through; the board-frame position goes to the fragment shader. */
export const VERTEX = /* glsl */ `
attribute vec3 aSide;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vSide;
void main() {
  vPos = position;
  vNormal = normal;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

/** Shared by every surface: noise, the outline's distance, and the last step from light to screen. (Exported for the pieces' shaders.) */
export const COMMON = /* glsl */ `
uniform vec4 uScreen;   // drawing buffer width, height; vignette strength (0 when off), vignette start
uniform vec4 uGrade;    // the warm grade as a gain on r, g, b (1, 1, 1 when off); the tone curve's shoulder start
uniform vec4 uOutline;  // the slabs together: x0, y0, x1, y1
uniform vec4 uShape;    // corner radius, rim width, margin, thickness
uniform vec3 uKeyDir;   // unit vector toward the key light
uniform vec4 uLight;    // key's share of the light on an upward face, shadows on, lit tier, surface detail
uniform sampler2D uNoise;
uniform vec4 uSeams;    // x of the two seams; in the former construction the groove's width and its depth
uniform vec4 uBoards[3];  // the three mounted boards: x0, y0, x1, y1
uniform vec4 uSheets[3];  // the printed sheet on each
uniform vec4 uMount;    // border, gap, the sheet's corner radius; 1 for mounted boards, 0 for the former construction
uniform vec4 uWrap;     // the covering paper's colour (linear); strength of its folds
uniform vec4 uWrapB;    // strength of its wear; depth of its relief; strength of the sheet's cut edge; a seed for the folds
uniform vec4 uWrapC;    // the room's light on the table inside a joint; the table's light back onto a wall; gain of the coarser relief; radius of the top arris
uniform sampler2D uWrapTex;  // r height (tooth and fibres), g slow mottle, b pale flecks, a dark flecks
uniform vec4 uLamp;     // the lamp over the table: its place x, y and its height; the light its reflection adds to the sheet at its middle, seen from above
uniform vec4 uLampB;    // sharpness of its reflection on the sheet; its light on the table top; sharpness there; how much it grows toward a grazing angle
uniform vec4 uRig;      // the light (lights.ts): the lamp's pool; the table's own pool; the lamp's reflection on the counters; the counters' extra gloss
uniform vec4 uPaper;    // the printed paper's relief in its sheen: its cockle; its fibre and tooth; how much handling has rubbed it smoother in places
uniform samplerCube uRoomMap;  // the room (rooms.ts, env.ts): its panorama prefiltered by roughness, in the room's frame
uniform vec4 uRoom;     // the room: on; its radiance's scale; cos, sin of its turn
uniform vec4 uRoomB;    // how much of its colour reaches the light; its reflections' gain; the cube's last mip level; unused
uniform vec4 uRoomC;    // roughness of the printed sheet and of the counters' faces in it; the most the sheet's reflection adds; unused
uniform vec3 uRoomSH[9];
uniform vec3 uRoomUp;   // the room's light on an upward face, its luminance 1, its colour as uRoomB.x leaves it

/** A direction of the board's frame in the room's (y up), after the room's turn (rooms.ts, roomFrame). */
vec3 roomFrame(vec3 d) {
  return vec3(uRoom.z * d.x + uRoom.w * d.y, d.z, uRoom.w * d.x - uRoom.z * d.y);
}

/** The room's colour, taken toward grey by uRoomB.x. */
vec3 roomTone(vec3 c) {
  return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uRoomB.x);
}

/** The room's light on a face of normal n (board frame): 1 in luminance on an upward face (rooms.ts, roomIrradiance). */
vec3 roomIrradiance(vec3 n) {
  vec3 d = roomFrame(n);
  vec3 c = uRoomSH[0] * 0.282095
    + uRoomSH[1] * (0.488603 * d.y) + uRoomSH[2] * (0.488603 * d.z) + uRoomSH[3] * (0.488603 * d.x)
    + uRoomSH[4] * (1.092548 * d.x * d.y) + uRoomSH[5] * (1.092548 * d.y * d.z) + uRoomSH[6] * (0.315392 * (3.0 * d.z * d.z - 1.0))
    + uRoomSH[7] * (1.092548 * d.x * d.z) + uRoomSH[8] * (0.546274 * (d.x * d.x - d.y * d.y));
  return roomTone(max(c, vec3(0.0)));
}

/** The light of the room's part of the light (the key's share is the rest) on a face of normal n: without a room, the old sky. */
vec3 roomLight(vec3 n) {
  return uRoom.x > 0.5 ? roomIrradiance(n) : vec3(0.5 + 0.5 * n.z);
}

/** The room mirrored along r (board frame) in a finish of roughness rough (perceptual, 0 a mirror): as the scene's light, the room's share of it. */
vec3 roomRadiance(vec3 r, float rough) {
  if (uRoom.x < 0.5) return vec3(0.0);
  float lod = uRoomB.z * rough * (2.0 - rough);
  vec3 c = textureLod(uRoomMap, roomFrame(r), lod).rgb * (uRoom.y * uRoomB.y * (1.0 - uLight.x));
  // Below the table's plane a reflection sees the table, not the room's floor: dim.
  return roomTone(c) * mix(0.2, 1.0, smoothstep(-0.2, 0.02, r.z));
}

/** The split sum's scale and bias for a finish of reflectance f0 facing the eye (Karis's fit, 2014). */
vec3 roomBRDF(vec3 f0, float rough, float nv) {
  vec4 r = rough * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float roundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/** The lamp's pool at a point (lit tiers): 1 straight under the lamp, falling off as a bare lamp's light does (cos^3), by uRig.x (0: none). */
float lampPool(vec3 p) {
  if (uLight.z < 0.5 || uRig.x <= 0.0) return 1.0;
  vec3 d = uLamp.xyz - p;
  float c = d.z / max(length(d), 1e-4);
  return mix(1.0, c * c * c, uRig.x);
}

/** The slope of a surface whose height is a channel of a tiling texture (pick chooses it), by differences a texel apart. */
vec2 slopeOf(sampler2D t, vec2 st, float texel, vec4 pick) {
  float v0 = dot(texture2D(t, st), pick);
  return vec2(dot(texture2D(t, st + vec2(texel, 0.0)), pick) - v0, dot(texture2D(t, st + vec2(0.0, texel)), pick) - v0);
}

/** Signed distance to the slabs' outline (negative inside). */
float outlineDistance(vec2 p) {
  return roundRect(p - 0.5 * (uOutline.xy + uOutline.zw), 0.5 * (uOutline.zw - uOutline.xy), uShape.x);
}

/** Signed distance to a rounded rectangle given by its corners (negative inside). */
float rrect(vec2 p, vec4 r, float rad) {
  return roundRect(p - 0.5 * (r.xy + r.zw), 0.5 * (r.zw - r.xy), rad);
}

/** The way out of a rounded rectangle at a point: the unit vector along which its distance grows. */
vec2 rrectOut(vec2 p, vec4 r, float rad) {
  vec2 c = p - 0.5 * (r.xy + r.zw);
  vec2 q = abs(c) - 0.5 * (r.zw - r.xy) + rad;
  vec2 s = vec2(c.x < 0.0 ? -1.0 : 1.0, c.y < 0.0 ? -1.0 : 1.0);
  if (q.x > 0.0 && q.y > 0.0) return s * normalize(q);
  return q.x > q.y ? vec2(s.x, 0.0) : vec2(0.0, s.y);
}

/** The board a point of the plan belongs to by the slab rule: 0, 1 or 2. */
int boardOf(vec2 p) {
  return p.x < uSeams.x ? 0 : (p.x < uSeams.y ? 1 : 2);
}

// ---- the covering paper (ruling 32): a rough matte brown paper over a hard board ------------------

const float WRAP_TILE = 1.28;   // the side of the wrap's texture, in h

/** A point turned by an angle given as its cosine and sine. */
vec2 turned(vec2 v, vec2 cs) {
  return vec2(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y);
}

/**
 * The paper's own colour at a point of its surface. uv is in h along two
 * directions of the surface; slope is how its height changes along each: the
 * fine tooth a texel, and with it the coarser lie of the fibres, which is what
 * is left of the relief when the paper is seen from further off.
 */
vec3 wrapPaper(vec2 uv, vec2 dx, vec2 dy, out vec2 slope) {
  vec2 s = uv / WRAP_TILE;
  vec2 sx = dx / WRAP_TILE;
  vec2 sy = dy / WRAP_TILE;
  vec4 t = textureGrad(uWrapTex, s, sx, sy);
  float e = 1.0 / 512.0;
  slope = (vec2(textureGrad(uWrapTex, s + vec2(1.5 * e, 0.0), sx, sy).r, textureGrad(uWrapTex, s + vec2(0.0, 1.5 * e), sx, sy).r) - t.r) / 1.5;
  // The coarser relief: the same height, smoothed over two texels and differenced across three.
  float lod = max(log2(max(length(sx), length(sy)) * 512.0), 1.0);
  float c0 = textureLod(uWrapTex, s, lod).r;
  slope += uWrapC.z * (vec2(textureLod(uWrapTex, s + vec2(3.0 * e, 0.0), lod).r, textureLod(uWrapTex, s + vec2(0.0, 3.0 * e), lod).r) - c0);
  vec4 slow = textureGrad(uNoise, uv * 0.21 + 0.37, dx * 0.21, dy * 0.21);
  vec3 c = uWrap.rgb;
  c *= 1.0 + 0.20 * (t.g - 0.5) + 0.12 * (slow.r - 0.5);
  // Fibres that lie on top are paler; the hollows between them hold the dark.
  c *= 1.0 + 0.18 * (t.r - 0.45);
  c = mix(c, c * 1.6 + 0.015, 0.55 * t.b);
  c *= 1.0 - 0.22 * t.a;
  return c;
}

/**
 * Wear of the wrap: rubbed paler at an arris, in runs of no fixed length with
 * long stretches untouched between them, most at the corners, and worn through
 * to the board in a few places there. wp is a point of the wrap laid out flat
 * (the plan, with a wall folded out from its arris), so that a scuff lies across
 * the arris on both faces; da is the distance from the arris along the paper;
 * width how far a rub reaches from it; corner is 1 at a corner.
 */
vec3 wrapWorn(vec3 c, float da, float width, float gain, float corner, vec2 wp, vec2 dx, vec2 dy) {
  float amount = uWrapB.x * gain;
  if (amount <= 0.0 || da > 6.0 * width) return c;
  // Three scales, each read across the noise's lattice at its own angle: a straight arris walked
  // along a row of the lattice gives marks at one pitch, which reads as stitching.
  vec2 ca = vec2(0.7934, 0.6087);
  vec2 cb = vec2(0.3420, -0.9397);
  vec4 zone = textureGrad(uNoise, turned(wp, ca) * 0.17 + 0.11, turned(dx, ca) * 0.17, turned(dy, ca) * 0.17);
  vec4 mid = textureGrad(uNoise, turned(wp, cb) * 1.13 + 0.53, turned(dx, cb) * 1.13, turned(dy, cb) * 1.13);
  vec4 brk = textureGrad(uNoise, turned(wp, ca) * 3.7 + 0.29, turned(dx, ca) * 3.7, turned(dy, ca) * 3.7);
  float fine = textureGrad(uWrapTex, wp / WRAP_TILE * 1.7 + 0.3, dx / WRAP_TILE * 1.7, dy / WRAP_TILE * 1.7).r;
  // Where the board has been handled at all: under half of an arris' length, in stretches of an h or so.
  float handled = smoothstep(0.50, 0.60, zone.r);
  float heavy = 0.35 + 1.3 * smoothstep(0.40, 0.72, zone.g);
  // Within a handled stretch, the scuffs themselves: some long, some a nick, ragged at their ends.
  float scuff = smoothstep(0.47, 0.60, 0.62 * mid.g + 0.26 * brk.r + 0.12 * fine);
  float along = max(handled * heavy * scuff, corner * smoothstep(0.30, 0.50, 0.55 * mid.r + 0.3 * brk.g + 0.15 * fine) * (0.7 + 0.6 * zone.b));
  // A heavy scuff reaches further from the arris than a light one.
  float reach = width * (0.5 + 0.7 * min(along, 1.0) * mid.b);
  float arris = exp(-da / reach);
  // The arris itself is a little burnished everywhere: the paper is tight over the board's edge.
  float rub = (arris * along + 0.10 * exp(-da / (0.4 * width))) * amount;
  // Rubbed paper: its fibres stand up pale and dull.
  vec3 pale = uWrap.rgb * 1.9 + vec3(0.05, 0.043, 0.034);
  c = mix(c, pale * (0.88 + 0.24 * fine), clamp(rub, 0.0, 1.0) * 0.6);
  // Through to the grey board, only where a corner has had the worst of it.
  float through = arris * arris * (0.2 + 0.8 * corner) * smoothstep(0.66 - 0.12 * corner, 0.80, 0.55 * mid.b + 0.45 * zone.b + 0.08 * corner) * handled * amount;
  c = mix(c, vec3(0.33, 0.30, 0.25) * (0.85 + 0.3 * brk.g), clamp(through, 0.0, 1.0) * 0.7);
  return c;
}

/** The room's colour on an upward face as a gain on the light (luminance 1; env.ts works it out once): the key's share stays white. */
vec3 roomTint() {
  return uRoom.x > 0.5 ? uLight.x + (1.0 - uLight.x) * uRoomUp : vec3(1.0);
}

/** Light on a matte face: the key by its angle, the room by how much of it the face sees. No highlight. */
float wrapLight(vec3 N, float keyVis, float skyVis) {
  float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
  // The room's light (its luminance: its colour is laid on once, roomTint), or without a room the old sky.
  float sky = dot(roomLight(N), vec3(0.2126, 0.7152, 0.0722));
  return uLight.x * key * keyVis + (1.0 - uLight.x) * sky * skyVis;
}

/**
 * The same with the paper's tooth: Nb is the face's normal turned by the relief.
 * The relief moves the light by a share of what the face has, never more: where
 * the key only grazes a face, a tooth lit all or nothing would be a speckle.
 */
float wrapToothLight(vec3 N, vec3 Nb, float keyVis, float skyVis, float share) {
  float base = wrapLight(N, keyVis, skyVis);
  float lim = share * base + 0.004;
  float x = wrapLight(Nb, keyVis, skyVis) - base;
  return base + lim * x / (lim + abs(x));
}

const int PLEATS = 6;

/**
 * The folds of the wrap at a rounded corner: paper turned over a curve has
 * more of itself than the curve has room for, and takes it up in gathers. One
 * of them at each corner is the lap, where the paper from one side lies over
 * the paper from the other: it runs the whole height of the wall. The rest are
 * pleats of no fixed number, spacing or length: they start at the arris, where
 * the paper is pulled tightest, and most die out part of the way down the wall.
 * Returns a gain on the light. cid is the corner; theta runs 0 to a quarter turn
 * round it; arc is the length of a radian there (h); tdir the way theta grows on
 * the plan; px is h a pixel across a pleat; inward is the distance from the
 * arris across the face, down the distance from it down the wall (one is 0).
 */
float wrapFolds(float cid, float theta, float arc, vec2 tdir, float amount, float px, float inward, float down) {
  float gain = 1.0;
  vec2 L = normalize(uKeyDir.xy);
  float thick = uShape.w;
  float seed = uWrapB.w;
  float total = 0.0;
  for (int k = 0; k <= PLEATS; k++) total += 0.22 + hash12(vec2(cid * 7.0 + float(k) + 0.5, seed + 9.1));
  // Which gather is the lap: never the first or the last.
  float lapAt = 1.0 + floor(hash12(vec2(cid + 0.5, seed + 5.3)) * (float(PLEATS) - 2.0));
  float run0 = inward + down;
  float sgn = down - inward;
  float at = 0.0;
  for (int k = 0; k < PLEATS; k++) {
    float fk = float(k);
    vec2 id = vec2(cid * 7.0 + fk + 0.5, seed);
    float h1 = hash12(id);
    float h2 = hash12(id + vec2(0.0, 3.7));
    float h3 = hash12(id + vec2(0.0, 7.9));
    float h4 = hash12(id + vec2(0.0, 11.3));
    at += 0.22 + hash12(id + vec2(0.0, 9.1));
    float tk = at / total * 1.5707963;
    bool seam = abs(fk - lapAt) < 0.5;
    // A corner has the lap and from two to five pleats.
    float there = seam ? 1.0 : step(0.26, h4);
    // How far down the wall it runs, as a share of the board's thickness.
    float len = (0.22 + 0.85 * h3) * thick;
    float fade = seam ? 1.0 : 1.0 - smoothstep(0.3 * len, len, down);
    // Which side lies on top: the pleats lap toward the lap.
    float lap = seam ? (h2 < 0.5 ? 1.0 : -1.0) : (fk < lapAt ? 1.0 : -1.0);
    // No fold is ruled: it leans, it bends along its length, and is deeper in some places than others.
    float lean = (seam ? 0.16 : 0.5) * (h1 - 0.5);
    float wander = lean * sgn + (seam ? 0.4 : 1.0) * (0.0026 * sin(run0 * 34.0 + h1 * 40.0) + 0.0012 * sin(run0 * 83.0 + h2 * 17.0));
    float d = ((theta - tk) * arc + wander) * lap;
    float run = (seam ? 0.05 : 0.024) * (0.7 + 0.7 * h2);
    float line = max(0.0038, 0.75 * px);
    float thin = min(1.0, 0.0038 / (0.75 * px));
    float depth = amount * there * fade * (seam ? 1.1 : 0.6 + 0.7 * h1) * (0.8 + 0.25 * sin(run0 * 47.0 + h2 * 31.0));
    // A pleat's profile: a small step up at the lap's edge (d = 0), then a gentle fall back to the
    // face over its run. The light takes the two sides oppositely; g is how the gentle side meets the key.
    float g = dot(tdir * lap, L);
    float edge = exp(-d * d / (line * line)) * thin;
    float band = smoothstep(0.0, line, d) * (1.0 - smoothstep(0.55 * run, run, d));
    // A step that faces away from the key is a thin shadow, not a crack: it takes less than a lit one gives.
    float riser = g > 0.0 ? 0.3 : 1.0;
    gain *= clamp(1.0 + depth * g * (0.4 * band - riser * edge), 0.6, 1.6);
    // The foot of the step holds a little dark whichever way the light comes.
    float foot = exp(-(d + 0.7 * line) * (d + 0.7 * line) / (line * line)) * thin;
    gain *= 1.0 - (seam ? 0.08 : 0.2) * depth * foot;
  }
  return gain;
}

/** Linear light to the screen: grade, vignette, a soft shoulder just under white, the sRGB curve, a dither. */
vec4 finish(vec3 c) {
  c *= uGrade.rgb;
  vec2 q = gl_FragCoord.xy / uScreen.xy - 0.5;
  float r = length(q) * 1.41421356;
  float v = smoothstep(uScreen.w, 1.05, r);
  c *= 1.0 - uScreen.z * v * v;
  float start = uGrade.w;
  float peak = max(c.r, max(c.g, c.b));
  if (peak > start) {
    float d = 1.0 - start;
    c *= (1.0 - d * d / (peak + d - start)) / peak;
  }
  c = clamp(c, 0.0, 1.0);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  return vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------------------
// The board's top: art, overlay, paper
// ---------------------------------------------------------------------------

export const BOARD_FRAGMENT = /* glsl */ `
varying vec3 vPos;
${COMMON}
uniform sampler2D uArt;
uniform vec4 uArtXf;      // board point to texture coordinate: (p - xy) * zw
uniform float uArtOn;     // 1 on a piece of the baked map, 0 on the slab's own top (stock)
uniform vec4 uBoard;      // the map's rectangle
uniform vec3 uStock;

uniform vec4 uGridA;      // centre of hex (0, 0); lattice period along x and y
uniform vec4 uGridB;      // step to the odd columns' lattice; columns, rows
uniform vec2 uStep0;
uniform vec2 uStep1;
uniform vec2 uStep2;
uniform sampler2D uHexDigits;  // one texel a hex: its four digits
uniform sampler2D uHexTints;   // one texel a hex: reach, fire, selection, other
uniform sampler2D uHexTintsB;  // one texel a hex: path, objective, zone, the nearer part of the reach
uniform sampler2D uRuler;      // row 0: a column's two digits; row 1: a row's
uniform sampler2D uDigits;     // the digit atlas: distance to the nearest stroke
uniform vec4 uOverlay;    // strength, lines, labels, tints
uniform vec3 uInk;        // the overlay's ink, linear
uniform vec3 uTintInk[8];
uniform vec4 uLine;       // width in h, least width in px, the overlay's shift along x (a planted fault), label ink share
uniform vec4 uLabel;      // digit height, digit cell aspect, gap under the hex's top side, half a stroke (digit heights)
uniform vec4 uRulerA;     // digit height, y of row 0 in the last column, distance range of the atlas, atlas cells
uniform vec4 uFrame;      // the frame line's ink (linear), its width in h
uniform vec4 uFault;      // the art's shift along y on the middle slab; gloss; clean; unused
uniform sampler2D uHexSides;   // one bit for each of a hex's six sides that bars sight: r a tree side, g a crest, b a ridge, a a separator
uniform vec3 uSideDirA;   // which of its hex's sides lies toward each of the three steps
uniform vec3 uSideDirB;   // and away from each
uniform vec4 uSight;      // the lines that bar sight: on; unused; least width in px; how fully they cover what is under them
uniform vec4 uSightW;     // the width of each kind, in h
uniform vec4 uSightMode;  // for each kind: 0 it is printed on the map as an ink here; 1 it covers what is under it; 2 the art has printed it already, and only the grid's line is kept off it
uniform vec3 uSightInk[4];  // the ink of each kind, linear

uniform sampler2D uSurface;    // r tooth, g two-way fibre, b fine scratches, a sparse long scratches
uniform vec4 uSheen;      // key highlight, window highlight, reflectance facing the eye, grazing power
uniform vec4 uSheenB;     // key lobe, window lobe (sharpness), how far the sheen takes the print's colour, scratch gain
uniform vec3 uWinDir;     // unit vector toward the window the board mirrors at a low angle
uniform vec4 uWear;       // unevenness of tone, rim wear, burnish, unused

const float LABEL_DIGITS = 4.0;

/** The hex whose centre is nearest: its column and row, and the point's offset from that centre. */
void hexAt(vec2 p, out vec2 cell, out vec2 off) {
  vec2 q = p - uGridA.xy;
  vec2 ia = floor(q / uGridA.zw + 0.5);
  vec2 da = q - ia * uGridA.zw;
  vec2 ib = floor((q - uGridB.xy) / uGridA.zw + 0.5);
  vec2 db = q - uGridB.xy - ib * uGridA.zw;
  if (dot(da, da) <= dot(db, db)) { cell = vec2(2.0 * ia.x, ia.y); off = da; }
  else { cell = vec2(2.0 * ib.x + 1.0, ib.y); off = db; }
}

bool onBoard(vec2 cell) {
  return cell.x >= 0.0 && cell.y >= 0.0 && cell.x < uGridB.z && cell.y < uGridB.w;
}

/** Ink of a line: 1 on it, 0 off it; dist and width in pixels. A line under a pixel wide is paler, not narrower. */
float lineInk(float dist, float width) {
  return clamp(0.5 * width + 0.5 - dist, 0.0, min(1.0, width));
}

float digitInk(float digit, vec2 st, float pxPerUnit, float cells) {
  float fx = clamp(st.x, 0.02, 0.98);
  float d = textureLod(uDigits, vec2((digit + fx) / cells, clamp(st.y, 0.01, 0.99)), 0.0).r * uRulerA.z;
  float halfStroke = max(uLabel.w * pxPerUnit, 0.55);
  return clamp(halfStroke + 0.5 - d * pxPerUnit, 0.0, 1.0);
}

void main() {
  vec2 P = vPos.xy;
  vec2 dPx = dFdx(P);
  vec2 dPy = dFdy(P);
  float hPerPx = max(length(dPx), length(dPy));
  bool inMap = P.x >= uBoard.x && P.y >= uBoard.y && P.x <= uBoard.z && P.y <= uBoard.w;
  bool mounted = uMount.w > 0.5;

  // ---- the mounted board: which board, and how far inside its printed sheet -------------------
  int bi = 0;
  float sdSheet = -1.0;
  float cov = 1.0;
  if (mounted) {
    bi = boardOf(P);
    sdSheet = rrect(P, uSheets[bi], uMount.z);
    // A piece of the map is one picture across the joints: what lies off the sheet is not printed.
    // It is cut a little way out on the wrap, where it and the board's own top are the same brown.
    if (uArtOn > 0.5 && sdSheet > 0.3 * uMount.x) discard;
    cov = clamp(0.5 - sdSheet / hPerPx, 0.0, 1.0);
  }

  // ---- the print ---------------------------------------------------------------------------
  vec2 artP = P;
  if (uFault.x != 0.0 && P.x > uSeams.x && P.x < uSeams.y) artP.y -= uFault.x;
  vec3 col = uStock;
  if (uArtOn > 0.5) col = texture2D(uArt, (artP - uArtXf.xy) * uArtXf.zw).rgb;

  float sd = outlineDistance(P);
  vec4 nz = texture2D(uNoise, P * 0.043 + vec2(0.13, 0.71));
  vec4 nz2 = texture2D(uNoise, vec2(P.x * 0.82 - P.y * 0.57, P.x * 0.57 + P.y * 0.82) * 0.117);

  // ---- wear: the rim, inside the margin (every tier; it is part of the sheet) ----------------
  float clean = uFault.z;
  if (!mounted && !inMap && uWear.y > 0.0 && clean < 0.5) {
    vec4 nr = texture2D(uNoise, P * 1.9);
    vec4 nf = texture2D(uNoise, P * 7.3 + 0.37);
    vec2 toCorner = 0.5 * (uOutline.zw - uOutline.xy) - abs(P - 0.5 * (uOutline.xy + uOutline.zw));
    float corner = 1.0 - smoothstep(0.1, 0.9, max(toCorner.x, toCorner.y));
    // The worn band is never wider than the rim width the page publishes: widest at the corners.
    float rim = uShape.y * mix(0.3 + 0.5 * nr.g, 0.9, corner * nr.r);
    float inward = -sd + (nf.r - 0.5) * 0.01;
    float scuff = (1.0 - smoothstep(0.3 * rim, rim, inward)) * uWear.y;
    vec3 scuffed = vec3(0.80, 0.775, 0.72) * (0.9 + 0.2 * nf.g);
    col = mix(col, scuffed, scuff * (0.35 + 0.4 * nf.b));
    // Nicks: the grey board shows where the sheet is gone, mostly at the corners.
    float nick = smoothstep(0.82 - 0.22 * corner, 0.93, nr.b + 0.3 * nf.a) * (1.0 - smoothstep(0.2 * rim, 0.55 * rim, inward)) * uWear.y;
    col = mix(col, vec3(0.36, 0.31, 0.25) * (0.8 + 0.5 * nf.r), nick * 0.7);
    // Handling: the outer margin is a little soiled.
    col *= 1.0 - 0.03 * uWear.y * (1.0 - smoothstep(0.0, uShape.z, -sd)) * (0.4 + nz2.g);
  }

  // ---- handling: the sheet's outer margin is a little soiled (mounted boards) -----------------
  if (mounted && !inMap && uWear.y > 0.0 && clean < 0.5) {
    col *= 1.0 - 0.035 * uWear.y * (1.0 - smoothstep(0.0, uShape.z, -sdSheet)) * (0.4 + nz2.g);
  }

  // ---- the groove at each seam (the former construction) ---------------------------------------
  if (!mounted) {
    float pxX = max(length(vec2(dPx.x, dPy.x)), 1e-6);
    float sigma = uSeams.z * 0.6005612;
    float wide = max(sigma, 0.6 * pxX);
    float dx = min(abs(P.x - uSeams.x), abs(P.x - uSeams.y));
    float g = exp(-dx * dx / (wide * wide));
    col *= 1.0 - uSeams.w * g * sigma / wide;
  }

  // ---- how the paper takes the light (the lit tiers) ------------------------------------------
  if (uLight.z > 0.5) {
    vec3 V = normalize(cameraPosition - vec3(P, 0.0));
    float nv = clamp(V.z, 0.0, 1.0);
    // The sheet is not flat: it cockles a little (waves a few centimetres long) and its fibres stand up; handling has
    // rubbed some places smoother. Its sheen breaks up over them rather than sliding as one smooth patch.
    vec2 pslope = slopeOf(uNoise, P * 0.13 + 0.17, 1.0 / 64.0, vec4(0.5, 0.5, 0.0, 0.0)) * uPaper.x;
    if (uLight.w > 0.5) pslope += slopeOf(uSurface, P * 0.39, 1.0 / 512.0, vec4(0.6, 0.4, 0.0, 0.0)) * uPaper.y;
    vec3 R = reflect(-V, normalize(vec3(-pslope, 1.0)));
    float handled = 1.0 + uPaper.z * (smoothstep(0.35, 0.75, nz2.g) * 0.5 - 0.2);
    float gloss = uFault.y;
    float uneven = (nz.r - 0.5) * 1.3 + (nz2.r - 0.5) * 0.7;
    float burnish = 1.0 + uWear.z * ((nz.g - 0.5) * 1.2 + (nz2.b - 0.5) * 0.8);
    float texGain = 1.0;
    float catchLight = 0.0;
    if (clean < 0.5) col *= 1.0 + uWear.x * uneven;
    float graze = pow(1.0 - nv, uSheen.w);
    float fres = uSheen.z + (1.0 - uSheen.z) * graze;
    float key = exp(-uSheenB.x * handled * (1.0 - dot(R, uKeyDir)));
    float win = exp(-uSheenB.y * handled * (1.0 - dot(R, uWinDir)));
    // The lamp over the table: a near light, so its reflection has a place on the sheet.
    float lampLobe = exp(-uLampB.x * handled * (1.0 - dot(R, normalize(uLamp.xyz - vec3(P, 0.0)))));
    float lampGain = uLamp.w * (1.0 + uLampB.w * graze);
    float spec = fres * (uSheen.x * key + uSheen.y * win) + lampGain * lampLobe;
    // The fine surface shows in the highlight and nowhere else, so it is read only where there is one.
    float glint = fres * (uSheen.x * sqrt(key) + uSheen.y * sqrt(win)) + lampGain * sqrt(lampLobe);
    if (uLight.w > 0.5 && clean < 0.5 && glint > 0.012) {
      vec4 sa = textureGrad(uSurface, P * 0.39, dPx * 0.39, dPy * 0.39);
      vec4 sb = textureGrad(uSurface, vec2(P.x * 0.6 + P.y * 0.8, P.y * 0.6 - P.x * 0.8) * 1.07 + 0.31, vec2(dPx.x * 0.6 + dPx.y * 0.8, dPx.y * 0.6 - dPx.x * 0.8) * 1.07, vec2(dPy.x * 0.6 + dPy.y * 0.8, dPy.y * 0.6 - dPy.x * 0.8) * 1.07);
      vec4 sc = textureGrad(uSurface, vec2(P.x * 0.94 - P.y * 0.34, P.x * 0.34 + P.y * 0.94) * 0.171 + 0.63, vec2(dPx.x * 0.94 - dPx.y * 0.34, dPx.x * 0.34 + dPx.y * 0.94) * 0.171, vec2(dPy.x * 0.94 - dPy.y * 0.34, dPy.x * 0.34 + dPy.y * 0.94) * 0.171);
      float fade = smoothstep(0.012, 0.04, glint);
      float tooth = (sa.r - 0.5) * 0.9 + (sb.r - 0.5) * 0.7 + (sa.g - 0.5) * 0.8;
      texGain = max(0.0, 1.0 + 1.1 * tooth * fade);
      catchLight = uSheenB.w * (0.55 * sb.b + 1.5 * sc.a + 0.9 * sa.a * sa.a) * fade;
    }
    if (gloss > 0.5) {
      // Planted fault for the judges: a plastic coat. A lamp overhead shows in it as a hard spot.
      spec += fres * 9.0 * exp(-240.0 * (1.0 - dot(R, normalize(vec3(0.06, -0.22, 1.0)))));
      texGain = 1.0; catchLight = 0.0; burnish = 1.0;
    }
    // Scratches catch the light a little outside the highlight too.
    float lit = spec * burnish * texGain * (1.0 + catchLight) + catchLight * 0.05 * glint;
    // The room (rooms.ts): its colour on the print, and its reflection in the sheet by the paper's roughness (smoother
    // where handling has rubbed it), broken by the same tooth; never more than uRoomC.z of white, so that no glare
    // hides a hex number.
    vec3 roomSpec = vec3(0.0);
    if (uRoom.x > 0.5) {
      float pr = clamp(uRoomC.x / handled, 0.05, 1.0);
      roomSpec = min(roomRadiance(R, pr) * roomBRDF(vec3(0.04), pr, nv) * burnish * texGain, vec3(uRoomC.z));
      col *= roomTint();
    }
    vec3 tint = mix(vec3(1.0), col, uSheenB.z);
    if (clean < 0.5 || gloss > 0.5) col += lit * tint * vec3(1.0, 0.975, 0.93) + roomSpec * tint;
  }

  // ---- the frame line and the overlay: multiplied inks ----------------------------------------
  float sx = uLine.z;
  vec2 G = P - vec2(sx, 0.0);
  if (!inMap) {
    // The frame line lies in the margin, against the map's rectangle.
    vec2 outside = max(uBoard.xy - P, P - uBoard.zw);
    float dOut = max(outside.x, outside.y);
    float w = max(uFrame.w / hPerPx, 1.2);
    col *= mix(vec3(1.0), uFrame.rgb, lineInk(abs(dOut / hPerPx - 0.5 * w), w));
  }
  float strength = uOverlay.x;
  if (strength > 0.0) {
    vec2 cell; vec2 off;
    hexAt(G, cell, off);
    bool here = onBoard(cell);
    float ink = 0.0;
    // The lines that bar sight (ruling 34): drawn over the grid, on the sides the map sets.
    // A kind is printed on the map as an ink (it multiplies), or laid over it (it covers), or is in
    // the art already, where all that is done is to keep the grid's line off it.
    float sight = 0.0;
    vec3 sightCol = vec3(0.0);
    float printed = 0.0;
    vec3 printedCol = vec3(1.0);
    float kept = 0.0;
    ivec4 sideBits = here && uSight.x > 0.5 ? ivec4(texelFetch(uHexSides, ivec2(cell), 0) * 255.0 + 0.5) : ivec4(0);
    // How far inside its hex the point is, in h.
    float inside = 1e6;
    {
      // Distance to the nearest hexside that an on-board hex owns, in pixels across that side.
      vec2 steps[3];
      steps[0] = uStep0; steps[1] = uStep1; steps[2] = uStep2;
      for (int k = 0; k < 3; k++) {
        vec2 e = steps[k];
        float len = length(e);
        vec2 n = e / len;
        float t = dot(off, n);
        float d = 0.5 * len - abs(t);
        inside = min(inside, d);
        if (uOverlay.y < 0.5 && uSight.x < 0.5) continue;
        bool owned = here;
        ivec4 bits = sideBits;
        // The side as its own hex numbers it: toward the step, or away from it.
        int dir = int((t > 0.0 ? uSideDirA[k] : uSideDirB[k]) + 0.5);
        if (!here) {
          vec2 c2; vec2 o2;
          hexAt(G - off + e * sign(t), c2, o2);
          owned = onBoard(c2);
          if (owned && uSight.x > 0.5) {
            bits = ivec4(texelFetch(uHexSides, ivec2(c2), 0) * 255.0 + 0.5);
            dir = int((t > 0.0 ? uSideDirB[k] : uSideDirA[k]) + 0.5);
          }
        }
        if (owned) {
          float perPx = max(length(vec2(dot(dPx, n), dot(dPy, n))), 1e-7);
          if (uOverlay.y > 0.5) {
            float w = max(uLine.x / perPx, uLine.y);
            ink = max(ink, lineInk(abs(d) / perPx, w));
          }
          if (uSight.x > 0.5) {
            int sideBit = 1 << dir;
            for (int c = 0; c < 4; c++) {
              if ((bits[c] & sideBit) == 0) continue;
              float cover = lineInk(abs(d) / perPx, max(uSightW[c] / perPx, uSight.z));
              if (uSightMode[c] > 1.5) kept = max(kept, cover);
              else if (uSightMode[c] > 0.5) {
                if (cover > sight) { sight = cover; sightCol = uSightInk[c]; }
              } else if (cover > printed) { printed = cover; printedCol = uSightInk[c]; }
            }
          }
        }
      }
    }
    // The grid's line does not show through a line that bars sight.
    ink *= 1.0 - max(kept, max(sight, printed));
    float labelInk = 0.0;
    if (uOverlay.z > 0.5) {
      float px = 1.0 / hPerPx;
      if (here) {
        float h = uLabel.x;
        float w = LABEL_DIGITS * uLabel.y * h;
        vec2 st = vec2((off.x + 0.5 * w) / w, (off.y + 0.5 * length(uStep0) - uLabel.z) / h);
        if (st.x > 0.0 && st.x < 1.0 && st.y > 0.0 && st.y < 1.0) {
          vec4 digits = texelFetch(uHexDigits, ivec2(cell), 0) * 255.0;
          float slot = floor(st.x * LABEL_DIGITS);
          float digit = slot < 0.5 ? digits.r : slot < 1.5 ? digits.g : slot < 2.5 ? digits.b : digits.a;
          labelInk = digitInk(floor(digit + 0.5), vec2(fract(st.x * LABEL_DIGITS), st.y), h * px, uRulerA.w) * smoothstep(4.5, 7.0, h * px);
        }
      } else if (!inMap) {
        // The rulers: a column's number above and below it, a row's number beside it.
        float h = uRulerA.x;
        float w = 2.0 * uLabel.y * h;
        vec2 mid = 0.5 * (uBoard.xy + uBoard.zw);
        vec2 st = vec2(-1.0);
        vec2 at = vec2(0.0);
        if (G.x > uBoard.x && G.x < uBoard.z) {
          float c = floor((G.x - uGridA.x) / uGridB.x + 0.5);
          float cy = G.y < mid.y ? uBoard.y - 0.5 * uShape.z : uBoard.w + 0.5 * uShape.z;
          if (c >= 0.0 && c < uGridB.z) { st = vec2((G.x - (uGridA.x + c * uGridB.x) + 0.5 * w) / w, (G.y - cy + 0.5 * h) / h); at = vec2(c, 0.0); }
        } else if (G.y > uBoard.y && G.y < uBoard.w) {
          bool left = G.x < mid.x;
          float y0 = left ? uGridA.y : uRulerA.y;
          float r = floor((G.y - y0) / uGridA.w + 0.5);
          float cx = left ? uBoard.x - 0.5 * uShape.z : uBoard.z + 0.5 * uShape.z;
          if (r >= 0.0 && r < uGridB.w) { st = vec2((G.x - cx + 0.5 * w) / w, (G.y - (y0 + r * uGridA.w) + 0.5 * h) / h); at = vec2(r, 1.0); }
        }
        if (st.x > 0.0 && st.x < 1.0 && st.y > 0.0 && st.y < 1.0) {
          vec4 digits = texelFetch(uRuler, ivec2(at), 0) * 255.0;
          float digit = st.x < 0.5 ? digits.r : digits.g;
          labelInk = digitInk(floor(digit + 0.5), vec2(fract(st.x * 2.0), st.y), h * px, uRulerA.w) * smoothstep(4.5, 7.0, h * px);
        }
      }
    }
    ink = max(ink, labelInk * uLine.w);
    col *= mix(vec3(1.0), uInk, ink * strength);
    if (uOverlay.w > 0.5 && here) {
      // A tint fills its hex to a line's width short of the sides, so that it never spills into a neighbour.
      float fill = clamp((inside - 0.012) / hPerPx + 0.5, 0.0, 1.0) * strength;
      vec4 t = texelFetch(uHexTints, ivec2(cell), 0);
      col *= mix(vec3(1.0), uTintInk[0], t.r * fill);
      col *= mix(vec3(1.0), uTintInk[1], t.g * fill);
      col *= mix(vec3(1.0), uTintInk[2], t.b * fill);
      col *= mix(vec3(1.0), uTintInk[3], t.a * fill);
      vec4 tb = texelFetch(uHexTintsB, ivec2(cell), 0);
      col *= mix(vec3(1.0), uTintInk[4], tb.r * fill);
      col *= mix(vec3(1.0), uTintInk[5], tb.g * fill);
      col *= mix(vec3(1.0), uTintInk[6], tb.b * fill);
      col *= mix(vec3(1.0), uTintInk[7], tb.a * fill);
    }
    // The lines that bar sight lie over everything printed and over the grid.
    col *= mix(vec3(1.0), printedCol, printed * strength);
    col = mix(col, sightCol, sight * uSight.w * strength);
  }

  // ---- the mounted board: the sheet's cut edge, and the wrap that shows round it ---------------
  if (mounted && sdSheet > -0.03) {
    vec4 brd = uBoards[bi];
    float rad = uShape.x;
    float sdBoard = rrect(P, brd, rad);
    vec2 bc = P - 0.5 * (brd.xy + brd.zw);
    vec2 q = abs(bc) - 0.5 * (brd.zw - brd.xy) + rad;
    vec2 slope;
    vec3 wrap = wrapPaper(P, dPx, dPy, slope);
    float corner = 1.0 - smoothstep(0.0, 0.45, max(-min(q.x, q.y), 0.0));
    // Distance in from the top arris, which begins where the flat face ends.
    float inFromArris = max(-sdBoard - uWrapC.w, 0.0);
    // A rub reaches a little way onto the face, and never across the whole of a narrow border.
    float rubWidth = min(0.009 + 0.012 * corner, 0.3 * uMount.x);
    vec2 wp = P + vec2(1.37, 2.91) * float(bi);
    if (clean < 0.5) wrap = wrapWorn(wrap, inFromArris, rubWidth, 1.0, corner, wp, dPx, dPy);
    float light = 1.0;
    if (uLight.z > 0.5) light = wrapToothLight(vec3(0.0, 0.0, 1.0), normalize(vec3(-uWrapB.y * 2.0 * slope, 1.0)), 1.0, 1.0, 0.5);
    if (q.x > 0.0 && q.y > 0.0 && uWrap.w > 0.0) {
      float theta = atan(q.y, q.x);
      float rho = length(q);
      vec2 sg = vec2(bc.x < 0.0 ? -1.0 : 1.0, bc.y < 0.0 ? -1.0 : 1.0);
      vec2 tdir = sg * vec2(-sin(theta), cos(theta));
      float cid = float(bi) * 4.0 + (sg.x > 0.0 ? 1.0 : 0.0) + (sg.y > 0.0 ? 2.0 : 0.0);
      // On the face the gathers lie open, pressed flat under the sheet's edge: plainest of all there.
      light *= wrapFolds(cid, theta, rho, tdir, uWrap.w * 1.15, hPerPx, max(rad - rho, 0.0), 0.0);
    }
    wrap *= light;
    if (uLight.z > 0.5) wrap *= roomTint();
    // The sheet has a thickness, just: its far side lays a hairline of shadow on the wrap, and all
    // round it the glue line is a little dark.
    vec2 nOut = rrectOut(P, uSheets[bi], uMount.z);
    float toKey = dot(nOut, normalize(uKeyDir.xy));
    float edge = uWrapB.z;
    float reach = max(0.004 + 0.010 * max(-toKey, 0.0), 1.2 * hPerPx);
    wrap *= 1.0 - edge * (0.24 + 0.4 * max(-toKey, 0.0)) * (1.0 - smoothstep(0.0, reach, sdSheet));
    // The cut shows the paper's white core: most toward the light, and unevenly, a little more of it
    // where the edge has been caught and at the sheet's corners. Never more than a hairline.
    vec4 fray = textureGrad(uNoise, turned(P, vec2(0.7934, 0.6087)) * 1.9 + 0.71, dPx * 1.9, dPy * 1.9);
    vec4 sheet = uSheets[bi];
    vec2 qs = abs(P - 0.5 * (sheet.xy + sheet.zw)) - 0.5 * (sheet.zw - sheet.xy) + uMount.z;
    float atCorner = clean < 0.5 ? smoothstep(-0.5 * uMount.z, 0.0, min(qs.x, qs.y)) : 0.0;
    float caught = clean < 0.5 ? smoothstep(0.52, 0.70, fray.b) : 0.0;
    float hair = max(0.0042 * (1.0 + 0.7 * caught + 0.5 * atCorner), hPerPx);
    float core = (1.0 - smoothstep(0.0, hair, -sdSheet)) * (0.28 + 0.72 * max(toKey, 0.0)) * min(1.0, 0.0042 / hPerPx);
    col = mix(col, vec3(0.90, 0.885, 0.84), edge * min(0.6 * core * (0.7 + 0.6 * caught + 0.4 * atCorner), 0.85));
    col = mix(wrap, col, cov);
  }
  gl_FragColor = finish(col * lampPool(vec3(P, 0.0)));
}
`;

// ---------------------------------------------------------------------------
// The slab's edge: the rounded top edge where the sheet turns over, and the wall
// ---------------------------------------------------------------------------

export const EDGE_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vSide;   // distance along the outline, height above the table, 0 at the top face rising to 1 on the wall
${COMMON}
uniform vec3 uStock;
uniform vec4 uFault;
uniform vec4 uShadow;

void main() {
  vec3 N = normalize(vNormal);
  float thick = uShape.w;
  vec4 nf = texture2D(uNoise, vec2(vSide.x * 2.3, vSide.y * 9.0));
  vec4 ng = texture2D(uNoise, vec2(vSide.x * 0.31, 0.5));
  float clean = uFault.z;
  if (uMount.w > 0.5) {
    // ---- a mounted board's edge: the wrap, from the top arris down to the table ------------------
    int bi = boardOf(vPos.xy);
    vec4 brd = uBoards[bi];
    float rad = uShape.x;
    vec2 bc = vPos.xy - 0.5 * (brd.xy + brd.zw);
    vec2 q = abs(bc) - 0.5 * (brd.zw - brd.xy) + rad;
    vec2 uv = vec2(vSide.x + 0.37 * float(bi), vSide.y + 0.19);
    vec2 dux = dFdx(uv);
    vec2 duy = dFdy(uv);
    vec2 slope;
    vec3 wrap = wrapPaper(uv, dux, duy, slope);
    float depth = max(thick - vSide.y, 0.0);
    float corner = 1.0 - smoothstep(0.0, 0.45, max(-min(q.x, q.y), 0.0));
    bool onArris = vSide.z < 0.999;
    // Distance down the wall from the top arris.
    float down = onArris ? 0.0 : max(depth - uWrapC.w, 0.0);
    // Wear: the wrap laid out flat, the wall folded out from its arris, so that a scuff lies across
    // the arris. The top arris has the most of it; the foot a little.
    vec2 wp = vPos.xy + rrectOut(vPos.xy, brd, rad) * down + vec2(1.37, 2.91) * float(bi);
    vec2 dwx = dFdx(wp);
    vec2 dwy = dFdy(wp);
    float topWidth = 0.011 + 0.016 * corner;
    float up = max(vSide.y, 0.0);
    if (clean < 0.5) {
      if (!onArris && 0.4 * exp(-up / 0.008) > exp(-down / topWidth)) wrap = wrapWorn(wrap, up, 0.008, 0.4, corner, wp, dwx, dwy);
      else wrap = wrapWorn(wrap, down, topWidth, 1.0, corner, wp, dwx, dwy);
    }
    float light = 0.72 + 0.28 * N.z;
    if (uLight.z > 0.5) {
      vec3 T = length(N.xy) > 1e-3 ? normalize(vec3(-N.y, N.x, 0.0)) : vec3(1.0, 0.0, 0.0);
      vec3 Bt = cross(N, T);
      // The arris is rubbed smooth: less of the paper's relief there.
      float relief = uWrapB.y * (onArris ? 0.4 : 1.0);
      vec3 Nb = normalize(N - relief * (slope.x * T + slope.y * Bt));
      // In a joint the other board stands in the way of the key and of most of the room.
      float keyVis = 1.0;
      float skyVis = 1.0;
      float dn = 1e3;
      for (int k = 0; k < 3; k++) if (k != bi) dn = min(dn, rrect(vPos.xy, uBoards[k], rad));
      if (dn < 0.6 && uLight.y > 0.5) {
        float dj = max(dn, 1e-4);
        skyVis = 1.0 - (1.0 - N.z) * depth / sqrt(depth * depth + dj * dj);
        vec2 track = uKeyDir.xy / uKeyDir.z * depth;
        float sh = 0.0;
        for (int i = 1; i <= 4; i++) {
          float t = float(i) / 4.0;
          vec2 p = vPos.xy + track * t;
          float sd = 1e3;
          for (int k = 0; k < 3; k++) if (k != bi) sd = min(sd, rrect(p, uBoards[k], rad));
          float w = max(t * depth * uShadow.z, 0.003);
          sh = max(sh, 1.0 - smoothstep(-w, w, sd));
        }
        keyVis = 1.0 - sh;
      }
      // The table hides half the room from the foot of the wall, and gives a little of its own light back.
      float h = max(vSide.y, 0.0);
      float foot = 0.5 * (1.0 - h / sqrt(h * h + 0.006)) * step(0.5, vSide.z) * uLight.y;
      light = wrapToothLight(N, Nb, keyVis, skyVis * (1.0 - foot) * 1.15, 0.2) + uWrapC.y * (1.0 - N.z) * max(skyVis, 0.35);
      light *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.014, vSide.y)) * step(0.5, vSide.z) * uLight.y;
    }
    if (q.x > 0.0 && q.y > 0.0 && uWrap.w > 0.0) {
      float theta = atan(q.y, q.x);
      vec2 sg = vec2(bc.x < 0.0 ? -1.0 : 1.0, bc.y < 0.0 ? -1.0 : 1.0);
      vec2 tdir = sg * vec2(-sin(theta), cos(theta));
      float cid = float(bi) * 4.0 + (sg.x > 0.0 ? 1.0 : 0.0) + (sg.y > 0.0 ? 2.0 : 0.0);
      float px = max(length(vec2(dFdx(vSide.x), dFdy(vSide.x))), 1e-6);
      // The gathers are tightest where the paper turns the arris, and ease out down the wall.
      light *= wrapFolds(cid, theta, rad, tdir, uWrap.w * (onArris ? 0.9 : 0.8), px, 0.0, down);
    }
    gl_FragColor = finish(wrap * light * lampPool(vPos) * (uLight.z > 0.5 ? roomTint() : vec3(1.0)));
    return;
  }
  // The sheet turns over the edge and part of the way down the wall; under it, the dark board.
  float turn = thick * (0.52 + 0.3 * (ng.g - 0.5) * (1.0 - clean));
  float wall = step(0.999, vSide.z) * smoothstep(-0.006, 0.006, turn - vSide.y);
  vec3 paper = uStock * vec3(0.93, 0.915, 0.87) * (0.92 + 0.12 * nf.g);
  float nick = clean < 0.5 ? smoothstep(0.7, 0.86, ng.b + 0.35 * nf.a) * 0.8 : 0.0;
  vec3 core = vec3(0.115, 0.095, 0.078) * (0.7 + 0.7 * nf.r) + vec3(0.05, 0.043, 0.035) * nf.b;
  vec3 col = mix(paper, core, max(wall, nick * step(0.5, vSide.z)));
  // A dark line where a seam meets the edge.
  float dx = min(abs(vPos.x - uSeams.x), abs(vPos.x - uSeams.y));
  col *= 1.0 - 0.7 * exp(-dx * dx / (uSeams.z * uSeams.z * 0.36));
  if (uLight.z > 0.5) {
    float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
    float sky = 0.5 + 0.5 * N.z;
    // The table hides half the sky from the foot of the wall.
    float h = max(vSide.y, 0.0);
    float foot = 0.5 * (1.0 - h / sqrt(h * h + 0.006)) * step(0.5, vSide.z) * uLight.y;
    float amb = sky * (1.0 - foot);
    col *= uLight.x * key + (1.0 - uLight.x) * amb * 1.15;
    col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.02, vSide.y)) * step(0.5, vSide.z) * uLight.y;
  } else {
    col *= 0.72 + 0.28 * N.z;
  }
  gl_FragColor = finish(col);
}
`;

// ---------------------------------------------------------------------------
// The table top: wood, with the slabs' shadow computed from their outline
// ---------------------------------------------------------------------------

export const TABLE_FRAGMENT = /* glsl */ `
varying vec3 vPos;
${COMMON}
uniform sampler2D uWood;   // r tone, g how open the grain is; one board wide, tiling
uniform vec4 uWoodXf;      // cos and sin of the grain's turn; a board's width and the texture's length, in h
uniform vec4 uPool;        // centre of the lamp's pool; where it starts to fall, and where it ends
uniform vec4 uShadow;      // the key's reach along the table for the slab's height (x, y); penumbra slope; contact width
uniform vec4 uTableSheen;  // key highlight, window highlight, reflectance facing the eye, lobe sharpness
uniform vec3 uWinDir;
uniform vec4 uFault;
uniform sampler2D uWoodColour;  // the scanned wood (scene/wood.ts): colour (sRGB), relief (OpenGL normal map), roughness
uniform sampler2D uWoodNormal;
uniform sampler2D uWoodRough;
uniform vec4 uWoodScan;    // 1 when the scan is there; the side of its square in h; how the finish wets it (a power, then a gain)
uniform vec4 uCoat;        // the clear coat: reflectance facing the eye; sharpness of the key's and the lamp's reflections; wear; scratches
uniform vec4 uCoatLight;   // how bright the key, the window and the lamp are in the coat; how bright the room is in it
uniform vec4 uCoatB;       // the coat's relief: its orange peel; its scratches of use; its swirls; its dents
uniform vec4 uWoodLook;    // the scanned wood (woods.ts): its own planks (1) or the table's strips (0); the normal map's gain; a coat over it (1) or the scan is the finish (0); how far the coat follows its relief
uniform vec4 uWoodLookB;   // the coat's roughness; the scan's roughness as the finish's: gain, bias; the wear's strength
uniform sampler2D uSurface;  // the sheet's surface texture: its scratches serve the coat

vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }

void main() {
  vec2 P = vPos.xy;
  // ---- wood ----------------------------------------------------------------------------------
  vec2 g = vec2(uWoodXf.x * P.x - uWoodXf.y * P.y, uWoodXf.y * P.x + uWoodXf.x * P.y);
  float boardNo = floor(g.y / uWoodXf.z);
  float across = g.y / uWoodXf.z - boardNo;
  float r1 = hash12(vec2(boardNo, 7.0));
  float r2 = hash12(vec2(boardNo, 19.0));
  vec2 uv = vec2(g.x / uWoodXf.w + r1 * 7.0 + boardNo * 0.37, across);
  vec2 duvx = vec2(dFdx(g.x) / uWoodXf.w, dFdx(g.y) / uWoodXf.z);
  vec2 duvy = vec2(dFdy(g.x) / uWoodXf.w, dFdy(g.y) / uWoodXf.z);
  vec4 wood = textureGrad(uWood, uv, duvx, duvy);
  vec4 fine = textureGrad(uWood, uv * vec2(9.0, 7.0) + 0.41, duvx * vec2(9.0, 7.0), duvy * vec2(9.0, 7.0));
  float v = 0.5 + (wood.r - 0.5) * 1.3 + 0.26 * (fine.r - 0.5) + (r1 - 0.5) * 0.2;
  vec3 pale = srgb(170.0, 118.0, 72.0);
  vec3 mid = srgb(126.0, 82.0, 48.0);
  vec3 dark = srgb(72.0, 43.0, 25.0);
  vec3 col = v < 0.5 ? mix(dark, mid, clamp(v * 2.0, 0.0, 1.0)) : mix(mid, pale, clamp(v * 2.0 - 1.0, 0.0, 1.0));
  col *= vec3(1.0 + (r2 - 0.5) * 0.06, 1.0, 1.0 - (r2 - 0.5) * 0.08);
  float pore = smoothstep(0.55, 0.85, fine.g) * 0.3;
  col *= 1.0 - pore;
  // The scanned wood, when the page has handed it over: one square of it, each board of the table taking its own
  // strip along the grain, wetted by the finish (darker and richer than the bare scan).
  bool scan = uWoodScan.x > 0.5;
  // A scan of planks (woods.ts) is laid as it is: its planks are the table's boards, and their joints are in it.
  bool ownPlanks = scan && uWoodLook.x > 0.5;
  vec3 nWood = vec3(0.0, 0.0, 1.0);
  float roughScan = 0.65;
  if (scan) {
    vec2 st = vec2(g.x + r1 * 37.0 + boardNo * 11.3, g.y + r2 * 29.0 + boardNo * 7.1) / uWoodScan.y;
    if (ownPlanks) st = g / uWoodScan.y + vec2(0.31, 0.17);
    vec2 sx = vec2(dFdx(g.x), dFdx(g.y)) / uWoodScan.y;
    vec2 sy = vec2(dFdy(g.x), dFdy(g.y)) / uWoodScan.y;
    col = pow(textureGrad(uWoodColour, st, sx, sy).rgb, vec3(uWoodScan.z)) * uWoodScan.w;
    // No two boards of the table were cut from the same log: each a little lighter or darker, warmer or cooler.
    if (!ownPlanks) col *= (1.0 + (r1 - 0.5) * 0.24) * vec3(1.0 + (r2 - 0.5) * 0.08, 1.0, 1.0 - (r2 - 0.5) * 0.1);
    // The relief, its x and y as the tool stored them (times the set's gain), made unit again.
    vec2 nxy = (textureGrad(uWoodNormal, st, sx, sy).xy * 2.0 - 1.0) / uWoodLook.y;
    nWood = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
    roughScan = textureGrad(uWoodRough, st, sx, sy).r;
    pore = 0.0;
  }
  // The joint between two boards: a hairline, with a slight ease either side (the table's own boards; a scan of planks has its own).
  float edge = ownPlanks ? 1.0 : min(across, 1.0 - across) * uWoodXf.z;
  float edgePx = edge / max(length(vec2(dFdx(g.y), dFdy(g.y))), 1e-6);
  col *= mix(0.5, 1.0, smoothstep(0.004, 0.02, max(edge, 0.0))) * mix(0.92, 1.0, smoothstep(0.02, 0.11, edge));
  col = mix(col, col * 0.75, (1.0 - smoothstep(0.0, 1.0, edgePx)) * 0.5);
  // Dust settles in the joints of the scanned table, where no cloth reaches.
  if (scan) col = mix(col, vec3(0.16, 0.145, 0.125), (1.0 - smoothstep(0.004, 0.016, edge)) * smoothstep(0.35, 0.7, texture2D(uNoise, P * 0.8 + 0.5).b) * 0.6);
  float rough = clamp(0.5 + 0.2 * wood.g + 0.35 * pore, 0.0, 1.0);

  // ---- the slabs' shadow, from their outline ---------------------------------------------------
  float lit = 1.0;
  float ao = 1.0;
  float contact = 0.0;
  vec2 centre = 0.5 * (uOutline.xy + uOutline.zw);
  vec2 halfSize = 0.5 * (uOutline.zw - uOutline.xy);
  float thick = uShape.w;
  float near = roundRect(P - centre, halfSize, uShape.x);
  if (uMount.w > 0.5) {
    // Three boards, each its own caster. Between two of them the table sees neither the key nor much of the room.
    if (uLight.y > 0.5 && near < 0.8) {
      vec2 vv = uShadow.xy;
      float vl = max(dot(vv, vv), 1e-8);
      float pix = 0.75 * length(fwidth(P)) + 0.001;
      float sh = 0.0;
      float occ = 0.0;
      float both = 0.0;
      float ddMin = 1e3;
      for (int b = 0; b < 3; b++) {
        vec2 bcn = 0.5 * (uBoards[b].xy + uBoards[b].zw);
        vec2 bhs = 0.5 * (uBoards[b].zw - uBoards[b].xy);
        vec2 p0 = P - bcn;
        float d0 = roundRect(p0, bhs, uShape.x);
        if (d0 > 0.8) continue;
        float t1 = clamp(-dot(p0, vv) / vl, 0.0, 1.0);
        vec2 cnr = sign(p0 + vv * t1) * (bhs - uShape.x);
        float t2 = clamp(dot(cnr - p0, vv) / vl, 0.0, 1.0);
        for (int i = 0; i < 6; i++) {
          float t = i < 4 ? float(i) / 3.0 : (i == 4 ? t1 : t2);
          float sdT = roundRect(p0 + vv * t, bhs, uShape.x);
          float w = max(t * thick * uShadow.z, pix);
          sh = max(sh, 1.0 - smoothstep(-w, w, sdT));
        }
        float dd = max(d0, 0.0);
        float o = 0.5 * (1.0 - dd / sqrt(dd * dd + thick * thick)) * (1.0 - smoothstep(0.15, 0.5, dd));
        both += occ * o;
        occ += o;
        ddMin = min(ddMin, dd);
      }
      lit = 1.0 - sh;
      // Inside a joint the table still has some of the room: what comes down the slit, and what the
      // two walls hand on. Deep shadow, and still wood.
      ao = clamp(1.0 - 0.8 * occ - 1.2 * both, 0.03, 1.0) + uWrapC.x * min(4.0 * both, 1.0);
      contact = 0.35 * exp(-ddMin / uShadow.w);
    }
  } else if (uLight.y > 0.5 && near < 0.8) {
    // The ray toward the key climbs the slab's height; seen from above its track is p0 .. p0 + v.
    vec2 p0 = P - centre;
    vec2 vv = uShadow.xy;
    float vl = max(dot(vv, vv), 1e-8);
    float pix = 0.75 * length(fwidth(P)) + 0.001;
    float t1 = clamp(-dot(p0, vv) / vl, 0.0, 1.0);
    vec2 cnr = sign(p0 + vv * t1) * (halfSize - uShape.x);
    float t2 = clamp(dot(cnr - p0, vv) / vl, 0.0, 1.0);
    float sh = 0.0;
    for (int i = 0; i < 6; i++) {
      float t = i < 4 ? float(i) / 3.0 : (i == 4 ? t1 : t2);
      float sdT = roundRect(p0 + vv * t, halfSize, uShape.x);
      float w = max(t * thick * uShadow.z, pix);
      sh = max(sh, 1.0 - smoothstep(-w, w, sdT));
    }
    lit = 1.0 - sh;
    float dd = max(roundRect(p0, halfSize, uShape.x), 0.0);
    float c1 = dd / sqrt(dd * dd + thick * thick);
    float reach = 0.5;
    ao = 1.0 - 0.4 * (1.0 - c1) * (1.0 - smoothstep(0.3 * reach, reach, dd));
    contact = 0.35 * exp(-dd / uShadow.w);
  }
  float share = uLight.x;
  float light = share * lit * (1.0 - contact) * (1.0 - 0.3 * (1.0 - ao)) + (1.0 - share) * ao * (1.0 - 0.6 * contact);

  // ---- the lamp's pool, and the satin finish ---------------------------------------------------
  float pool = (1.0 - uRig.y * smoothstep(uPool.z, uPool.w, length(P - uPool.xy))) * lampPool(vPos);
  vec3 outc = col * light * pool;
  if (scan && uLight.z > 0.5) {
    // ---- the scanned wood under a clear coat (polyurethane): a glossy layer over the rougher grain ----------------
    vec3 V = normalize(cameraPosition - vPos);
    float nv = clamp(V.z, 0.0, 1.0);
    // The grain's relief turns the key a little on the wood under the coat (its tangent runs along the grain).
    vec3 T = vec3(uWoodXf.x, -uWoodXf.y, 0.0);
    vec3 B = vec3(uWoodXf.y, uWoodXf.x, 0.0);
    vec3 Nb = normalize(T * nWood.x + B * nWood.y + vec3(0.0, 0.0, max(nWood.z, 0.2)));
    float relief = clamp(dot(Nb, uKeyDir) / uKeyDir.z, 0.0, 2.0);
    outc *= mix(1.0, relief, uLight.x * lit);
    // ---- the coat's own surface: never mathematically smooth ------------------------------------------------------
    // Where a point is along the boards and across them (h), and how much of the table a pixel covers there.
    vec2 q = vec2(dot(P, T.xy), dot(P, B.xy));
    float px = max(length(fwidth(P)), 1e-5);
    float nearSide = smoothstep(uOutline.w - 3.0, uOutline.w + 9.0, P.y);
    // The wood's own wear (woods.ts): a faint waviness of a brushed coat, and fine scratches of use; the first pass's
    // relief (uCoatB, gleam=1) comes on top of it.
    float wearW = uWoodLookB.w;
    // Orange peel: the brushed coat waves a little, a few millimetres from crest to crest.
    vec2 slope = slopeOf(uNoise, P * 1.7 + 0.21, 1.0 / 64.0, vec4(0.6, 0.0, 0.4, 0.0)) * (uCoatB.x + 0.03 * wearW * uWoodLook.z);
    // Use: fine scratches, mostly along the boards (things slid along them), most along the near side where hands
    // rest; and a few long ones any way. A scratch is a groove: its two walls lean opposite ways and catch the light apart.
    vec2 sA = slopeOf(uSurface, q * 0.22 + vec2(r1 * 0.37, boardNo * 0.29), 1.0 / 512.0, vec4(0.0, 0.0, 1.0, 0.0));
    vec2 sB = slopeOf(uSurface, turned(P, vec2(0.8, 0.6)) * 0.09 + 0.41, 1.0 / 512.0, vec4(0.0, 0.0, 0.0, 1.0));
    float use = (uCoatB.y + 0.035 * wearW) * (0.3 + 0.7 * nearSide);
    slope += (T.xy * sA.x + B.xy * sA.y) * use + vec2(0.8 * sB.x + 0.6 * sB.y, -0.6 * sB.x + 0.8 * sB.y) * use * 0.7;
    // Swirls: a cloth wiped in circles left faint arcs round a few centres; finer than a pixel from afar, they fade.
    float fine = 1.0 - smoothstep(0.012, 0.05, px);
    if (fine > 0.0) {
      vec2 base0 = floor(P / 7.0 - 0.5);
      for (int j = 0; j < 4; j++) {
        vec2 cellId = base0 + vec2(float(j - 2 * (j / 2)), float(j / 2));
        vec2 c = (cellId + vec2(hash12(cellId + 3.1), hash12(cellId + 7.7))) * 7.0;
        float rad = 1.8 + 2.2 * hash12(cellId + 1.9);
        vec2 d = P - c;
        float dl = length(d);
        if (dl > rad || dl < 0.05) continue;
        float arcs = cos(dl * 90.0 + hash12(cellId) * 40.0) * smoothstep(0.35, 0.65, texture2D(uNoise, d * 0.6 + cellId * 0.13).g);
        slope += (d / dl) * arcs * uCoatB.z * fine * (1.0 - dl / rad);
      }
      // Dents: a few small dints, each a soft dimple.
      vec2 dc = floor(P / 9.0);
      if (hash12(dc + 5.5) < 0.4) {
        vec2 c = (dc + vec2(hash12(dc + 1.1), hash12(dc + 2.2))) * 9.0;
        float r = 0.06 + 0.12 * hash12(dc + 3.3);
        vec2 d = P - c;
        float t = length(d) / r;
        slope -= (d / max(length(d), 1e-4)) * uCoatB.w * t * exp(-2.0 * t * t) * fine;
      }
    }
    // The joints: each board's edge eases down into the joint (a tiny step), and dust lies in it.
    float chamfer = 1.0 - smoothstep(0.0, 0.035, edge);
    slope += B.xy * (across < 0.5 ? 1.0 : -1.0) * chamfer * 0.22 * (0.6 + 0.8 * r2);
    // Rubbed and handled places: only a little rougher (the gleam a little broader there), never another colour, and
    // in broad soft areas, so that no patch reads as a stain.
    vec4 wz = texture2D(uNoise, P * 0.07 + 0.31);
    vec4 wy = texture2D(uNoise, P * 0.23 + 0.77);
    float worn = clamp(smoothstep(0.35, 0.85, 0.7 * wz.r + 0.3 * wy.g) * (0.45 + 0.55 * nearSide), 0.0, 1.0) * uCoat.z;
    float smudge = smoothstep(0.45, 0.9, wy.b) * (0.4 + 0.6 * nearSide);
    // The finish's roughness (perceptual, 0 a mirror): the coat's own, a little rougher where the wood under it is open;
    // or, where the scan is the finish, the scan's own roughness.
    float pr = uWoodLook.z > 0.5 ? uWoodLookB.x + 0.08 * uWoodLook.w * (roughScan - 0.35) : roughScan * uWoodLookB.y + uWoodLookB.z;
    pr = clamp(pr + wearW * (0.045 * worn + 0.035 * smudge) + 0.4 * chamfer, 0.03, 1.0);
    // A coat follows the wood's relief under it by uWoodLook.w; a scanned finish is that relief.
    vec3 Nc = normalize(vec3(-slope, 1.0) + uWoodLook.w * (Nb - vec3(0.0, 0.0, 1.0)));
    vec3 R = reflect(-V, Nc);
    float F = uCoat.x + (1.0 - uCoat.x) * pow(1.0 - clamp(dot(Nc, V), 0.0, 1.0), 5.0);
    // A gleam: as sharp as the finish and the light's own size allow (a lobe's width is the two together), its peak
    // lower as it spreads, so that it keeps its energy.
    float a2 = pr * pr * pr * pr;
    float k = 1.0 / (2.0 * a2 + 1.0 / uCoat.y);
    float energy = k / uCoat.y;
    float keyC = exp(-k * (1.0 - dot(R, uKeyDir))) * lit;
    float winC = exp(-0.5 * k * (1.0 - dot(R, uWinDir)));
    float lampC = exp(-0.5 * k * (1.0 - dot(R, normalize(uLamp.xyz - vPos))));
    // The coat mirrors the room as well as its lights: the walls toward the horizon, the ceiling above, dimmer than either light.
    // With a room on the table (rooms.ts) it mirrors that instead, by the coat's roughness.
    float room = uRoom.x > 0.5 ? 0.0 : uCoatLight.w * (0.55 + 0.45 * R.z) * (1.0 - 0.4 * pr);
    float glint = energy * (uCoatLight.x * uTableSheen.x * keyC + uCoatLight.y * uTableSheen.y * winC + uCoatLight.z * uLampB.y * lampC) + room;
    vec3 coat = F * glint * vec3(1.0, 0.97, 0.92);
    if (uRoom.x > 0.5) {
      coat += roomRadiance(R, pr) * roomBRDF(vec3(uCoat.x), pr, clamp(dot(Nc, V), 0.0, 1.0));
      outc *= roomTint();
    }
    // Under a coat, the wood's own satin, broad and dim, by its roughness; the coat takes its share first. (A scanned
    // finish has no second surface under it.)
    float kb = 6.0 / max(roughScan * roughScan, 0.05);
    float base = uWoodLook.z * (1.0 - F) * 0.02 * (uTableSheen.x * exp(-kb * (1.0 - dot(reflect(-V, Nb), uKeyDir))) * lit + uTableSheen.y * exp(-0.5 * kb * (1.0 - dot(reflect(-V, Nb), uWinDir))));
    outc = outc * (1.0 - F) + (coat + base * col * 4.0) * pool * ao;
    gl_FragColor = finish(outc);
    return;
  }
  if (uLight.z > 0.5) {
    vec3 V = normalize(cameraPosition - vPos);
    float nv = clamp(V.z, 0.0, 1.0);
    vec3 R = vec3(-V.xy, V.z);
    float fres = uTableSheen.z + (1.0 - uTableSheen.z) * pow(1.0 - nv, 4.0);
    float k = uTableSheen.w * (1.6 - rough);
    float gloss = 1.25 - rough;
    float key = exp(-k * (1.0 - dot(R, uKeyDir))) * lit;
    float win = exp(-0.7 * k * (1.0 - dot(R, uWinDir)));
    outc += fres * gloss * (uTableSheen.x * key + uTableSheen.y * win) * pool * ao * vec3(1.0, 0.96, 0.9);
    // The lamp in the varnish: broader and dimmer than on the sheet, and broken by the grain.
    float lampLobe = exp(-uLampB.z * (1.6 - rough) * (1.0 - dot(R, normalize(uLamp.xyz - vPos))));
    outc += uLampB.y * gloss * lampLobe * (1.0 + uLampB.w * pow(1.0 - nv, 4.0)) * ao * vec3(1.0, 0.96, 0.9);
    // The room (rooms.ts), mirrored by the satin varnish.
    if (uRoom.x > 0.5) {
      float vr = clamp(0.2 + 0.4 * rough, 0.0, 1.0);
      outc = outc * roomTint() + roomRadiance(R, vr) * roomBRDF(vec3(uTableSheen.z), vr, nv) * gloss * ao;
    }
  }
  gl_FragColor = finish(outc);
}
`;

// ---------------------------------------------------------------------------
// Start-up bakes: wood, the paper's surface, a small noise
// ---------------------------------------------------------------------------

export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAKE_NOISE = /* glsl */ `
varying vec2 vUv;
uniform float uSeed;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise that repeats every 'per' cells.
float pnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pfbm(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * pnoise(p + float(i) * 17.31, per);
    n += a; a *= 0.5; p *= 2.0; per *= 2.0;
  }
  return s / n;
}
`;

/** Wood, one board wide (128 mm at 20 mm a hex) and 512 mm long, tiling. r: tone; g: how open the grain is. */
export const BAKE_WOOD = /* glsl */ `
${BAKE_NOISE}
void main() {
  vec2 mm = vUv * vec2(512.0, 128.0);
  float drift = pfbm(vec2(mm.x / 256.0, mm.y / 64.0), vec2(2.0, 2.0), 4);
  float drift2 = pfbm(vec2(mm.x / 128.0 + 3.0, mm.y / 8.0), vec2(4.0, 16.0), 3);
  // Growth rings, strongly stretched along the board. 48 of them fit the board's width exactly, so it tiles.
  float t = mm.y * 0.9 + drift * 30.0 + drift2 * 2.2;
  float ring = 0.5 + 0.5 * sin(t * 6.28318 / 2.4);
  float late = pow(ring, 3.0);
  float streak = pfbm(vec2(mm.x / 128.0, mm.y / 1.0), vec2(4.0, 128.0), 4);
  float fine = pnoise(vec2(mm.x / 32.0, mm.y / 0.5), vec2(16.0, 256.0));
  float blot = pfbm(vec2(mm.x / 256.0, mm.y / 32.0) + 9.0, vec2(2.0, 4.0), 3);
  float mineral = smoothstep(0.80, 0.93, pnoise(vec2(mm.x / 256.0 + 1.5, mm.y / 4.0), vec2(2.0, 32.0)));
  float v = 0.52 + 0.42 * (streak - 0.5) + 0.14 * (fine - 0.5) - 0.17 * late + 0.34 * (blot - 0.5) - 0.2 * mineral;
  // How open the grain is. Sampled again nine times finer by the table's shader, this is its pores.
  float open = clamp(0.35 + 0.5 * late + 0.4 * (0.5 - streak), 0.0, 1.0);
  gl_FragColor = vec4(clamp(v, 0.0, 1.0), open, 0.0, 1.0);
}
`;

/**
 * The paper's surface, tiling. r: tooth (fine, even); g: fibres lying both ways,
 * none evenly spaced (a regular weave would beat against the pixel grid);
 * b: fine scratches, mostly one way; a: a few long scratches.
 */
export const BAKE_SURFACE = /* glsl */ `
${BAKE_NOISE}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 v = b - a;
  float t = clamp(dot(p - a, v) / max(dot(v, v), 1e-6), 0.0, 1.0);
  return length(p - a - v * t);
}
void main() {
  vec2 px = vUv * 512.0;
  // Every scale divides the tile's 512 pixels, so the texture repeats without a join.
  float tooth = pfbm(px / 2.0, vec2(256.0), 3);
  float fa = pnoise(vec2(px.x / 4.0, px.y / 32.0), vec2(128.0, 16.0));
  float fb = pnoise(vec2(px.x / 32.0 + 5.0, px.y / 4.0), vec2(16.0, 128.0));
  float fibre = 0.5 * fa + 0.5 * fb;
  float ma = pnoise(vec2(px.x / 32.0, px.y / 2.0) + 3.0, vec2(16.0, 256.0));
  float mb = pnoise(vec2((px.x + px.y) / 2.0, (px.x - px.y) / 32.0) + 11.0, vec2(256.0, 16.0));
  float fineScratch = max(smoothstep(0.74, 0.9, ma), 0.7 * smoothstep(0.8, 0.93, mb));
  // Long scratches: one to a cell of an 8 x 8 grid, most lying within a few degrees of two directions.
  float longScratch = 0.0;
  vec2 cell = floor(px / 64.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec2 id = mod(c, 8.0);
      float keep = hash12(id + 3.7);
      if (keep < 0.45) continue;
      vec2 mid = (c + vec2(hash12(id + 1.3), hash12(id + 2.9))) * 64.0;
      float way = hash12(id + 5.1);
      float ang = (way < 0.5 ? 0.35 : 2.2) + (hash12(id + 7.7) - 0.5) * (way < 0.8 ? 0.5 : 3.0);
      float len = 18.0 + 90.0 * hash12(id + 9.3) * hash12(id + 4.4);
      vec2 dir = vec2(cos(ang), sin(ang)) * len;
      float d = segment(px, mid - dir, mid + dir);
      float along = clamp(dot(px - mid, dir) / (len * len), -1.0, 1.0);
      longScratch = max(longScratch, (1.0 - smoothstep(0.35, 1.1, d)) * (0.35 + 0.65 * hash12(id + 6.6)) * (1.0 - along * along));
    }
  }
  gl_FragColor = vec4(tooth, fibre, fineScratch, longScratch);
}
`;

/**
 * The covering paper, tiling: a brown kraft-like paper seen close. r: height
 * (an even tooth, and fibres lying every way on top of it); g: a slow mottle;
 * b: pale flecks of fibre; a: dark specks.
 */
export const BAKE_WRAP = /* glsl */ `
${BAKE_NOISE}
float strand(float n) {
  float v = 1.0 - abs(2.0 * n - 1.0);
  v *= v; v *= v;
  return v * v;
}
void main() {
  vec2 px = vUv * 512.0;
  // Every scale divides the tile's 512 pixels, so the texture repeats without a join.
  float tooth = pfbm(px / 2.0 + 31.0, vec2(256.0), 3);
  // Fibres: four families of stretched noise, none lying along the tile's own axes, so that the
  // noise's lattice never shows as a row or a column. A fibre is a contour of its family.
  float f1 = strand(pnoise(vec2((2.0 * px.x + px.y) / 4.0, (px.x - 2.0 * px.y) / 32.0) + 3.0, vec2(128.0, 16.0)));
  float f2 = strand(pnoise(vec2((px.x + 2.0 * px.y) / 4.0, (2.0 * px.x - px.y) / 32.0) + 17.0, vec2(128.0, 16.0)));
  float f3 = strand(pnoise(vec2((2.0 * px.x - px.y) / 4.0, (px.x + 2.0 * px.y) / 32.0) + 29.0, vec2(128.0, 16.0)));
  float f4 = strand(pnoise(vec2((px.x - 2.0 * px.y) / 4.0, (2.0 * px.x + px.y) / 32.0) + 41.0, vec2(128.0, 16.0)));
  float lie = pnoise(vec2(px.x + px.y, px.x - px.y) / 16.0 + 5.0, vec2(32.0, 32.0));
  float lie2 = pnoise(vec2(px.x - px.y, px.x + px.y) / 16.0 + 9.0, vec2(32.0, 32.0));
  float fibre = max(max(f1 * lie, f2 * (1.0 - lie)), max(f3 * lie2, f4 * (1.0 - lie2)));
  // A slow unevenness under the tooth: the paper's felt side, a few tenths of a millimetre across.
  float cockle = pfbm(px / 8.0 + 13.0, vec2(64.0), 2);
  float height = clamp(0.2 + 0.4 * tooth + 0.26 * fibre + 0.2 * cockle, 0.0, 1.0);
  float mottle = pfbm(px / 32.0 + 7.0, vec2(16.0), 4);
  // Flecks lie askew too, and the dark ones are specks, not dashes.
  float pale = smoothstep(0.80, 0.94, pnoise(vec2((px.x + px.y) / 4.0, (px.x - px.y) / 8.0) + 53.0, vec2(128.0, 64.0))) * (0.4 + 0.6 * fibre);
  float dark = smoothstep(0.84, 0.95, pnoise(vec2(px.x - px.y, px.x + px.y) / 4.0 + 71.0, vec2(128.0, 128.0)));
  gl_FragColor = vec4(height, mottle, pale, dark);
}
`;

/** A small smooth noise, four channels, tiling: the slow unevenness of the sheet and the rim's wear. */
export const BAKE_NOISE_TILE = /* glsl */ `
${BAKE_NOISE}
void main() {
  vec2 p = vUv * 64.0;
  gl_FragColor = vec4(
    pfbm(p / 8.0, vec2(8.0), 4),
    pfbm(p / 8.0 + 21.0, vec2(8.0), 3),
    pfbm(p / 4.0 + 47.0, vec2(16.0), 4),
    pnoise(p / 2.0 + 73.0, vec2(32.0)));
}
`;

// ---------------------------------------------------------------------------
// The stress setting: GPU work that draws nothing
// ---------------------------------------------------------------------------

export const STRESS_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const STRESS_FRAGMENT = /* glsl */ `
uniform float uLoops;
void main() {
  vec2 p = gl_FragCoord.xy * 0.01;
  float s = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (float(i) >= uLoops) break;
    p = vec2(sin(p.y * 1.7 + float(i)), cos(p.x * 1.3 - s));
    s += p.x * p.y;
  }
  // The sum is wanted, so the loop must be run. What is added to the picture is under half a step of an
  // 8-bit channel, so no pixel changes; a shader that added exactly nothing would not be run at all.
  gl_FragColor = vec4(vec3(fract(s) * 0.0009), 1.0);
}
`;
