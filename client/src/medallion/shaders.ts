/**
 * The medallion's shaders (client/src/medallion/index.ts draws with them). Places are in the canvas's own
 * stage pixels, x across and y down from its top left corner; the model's own frame has its y upward and
 * its z toward the viewer. Every colour is written as light already weighed by its cover (premultiplied).
 */

/** Noise the fire is shaped by: a value at every place and time, smooth, the same for the same numbers. */
const NOISE = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float sum = 0.0;
  float gain = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += gain * noise(p);
    p = p * 2.03 + vec3(7.1, 3.3, 1.7);
    gain *= 0.5;
  }
  return sum / 0.875;
}
`;

/** A square over a part of the canvas (uRect: x, y, width, height), with a picture's own coordinates. */
export const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec2 uBox;
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 s = uRect.xy + aCorner * uRect.zw;
  vUv = aCorner;
  gl_Position = vec4(s.x / uBox.x * 2.0 - 1.0, 1.0 - s.y / uBox.y * 2.0, 0.0, 1.0);
}`;

export const QUAD_FS = `#version 300 es
precision highp float;
uniform sampler2D uPicture;
uniform float uShown;
uniform float uTurned;
in vec2 vUv;
out vec4 o;
void main() {
  // (A picture this canvas drew itself has its first row at the foot.)
  o = texture(uPicture, vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uTurned))) * uShown;
}`;

/** The whole canvas, with each pixel's place in stage pixels. */
export const FULL_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec2 uBox;
out vec2 vAt;
void main() {
  vAt = aCorner * uBox;
  gl_Position = vec4(aCorner.x * 2.0 - 1.0, 1.0 - aCorner.y * 2.0, 0.0, 1.0);
}`;

/**
 * The fire. At each pixel: how far off the medallion's outline it lies and the way out of the outline
 * there (the field); from the outline's nearest point, which sector of the outline that is, and with it
 * how hot the owner's fire is against the metal there and how far it reaches. The heat falls off with the
 * distance, counted in that reach, by the shape his falls off by; the reach is made ragged and alive by
 * noise that rises (flames climb) and sways. The heat's colour and cover are his (the ramp).
 */
export const FLAME_FS = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uRamp;
uniform sampler2D uRing;
uniform sampler2D uShape;
uniform vec4 uFieldBox;
uniform vec3 uRange;
uniform vec2 uMiddle;
uniform vec3 uIgnite;
uniform float uBurn;
uniform float uTime;
uniform float uRampSteps;
uniform float uTall;
#define TONGUES 6
uniform vec4 uTongueA[TONGUES];
uniform vec4 uTongueB[TONGUES];
uniform vec4 uPatch[2];
uniform float uBreath;
uniform vec3 uFlare;
uniform float uFar;
in vec2 vAt;
out vec4 o;
${NOISE}
void main() {
  vec2 p = vAt;
  vec3 f = texture(uField, (p - uFieldBox.xy) / uFieldBox.zw).rgb;
  float e = f.r * 2.0 - 1.0;
  float d = e >= 0.0 ? e * e * uRange.x : -e * e * uRange.y;
  // Far beyond anything that burns: nothing, and none of the work below.
  if (d > uFar) {
    o = vec4(0.0);
    return;
  }
  vec2 way = f.gb * 2.0 - 1.0;
  way = way / max(length(way), 1e-4);
  // Which sector of the outline this is (the pixel's own direction from the middle: the same on both sides of every corner).
  float sector = (atan(p.y - uMiddle.y, p.x - uMiddle.x) + 3.14159265) / 6.2831853;
  vec4 ring = texture(uRing, vec2(sector, 0.5));
  float core = ring.r;
  float reach = max(ring.g * uRange.z, 3.0);
  float tall = ring.b * uTall;
  float hot = max(ring.a, core);

  float t = uTime;
  float off = max(d, 0.0);
  // Everything sways a little. Flame shapes rise through the picture (they climb the sides and leave the top), with a
  // finer, faster flicker; hot clumps come and go against the metal.
  vec2 sway = vec2(fbm(vec3(p * 0.01, t * 0.3)), fbm(vec3(p * 0.01 + 31.7, t * 0.3))) - 0.5;
  vec2 pp = p + sway * 10.0;
  float rise = fbm(vec3(pp.x * 0.03, pp.y * 0.022 + t * 2.6, t * 0.5));
  float flick = noise(vec3(pp.x * 0.09, pp.y * 0.06 + t * 5.5, t * 1.3));
  float clump = fbm(vec3(pp.x * 0.024, pp.y * 0.024 + t * 0.9, t * 0.8));
  // His reach here, by the shape his heat falls off by; against the metal, his heat here, rising in clumps to his hottest.
  // (At the press the fire tears away outward: its reach grows as it goes.)
  float x = off / (reach * uFlare.y * (0.72 + 0.62 * rise));
  float fall = texture(uShape, vec2((x / 4.0) * (32.0 / 33.0) + 0.5 / 33.0, 0.5)).r;
  float against = mix(core * 0.85, hot * 1.1, smoothstep(0.3, 0.62, clump));
  // (The hot of a clump lies close against the metal.)
  float heat = mix(core * (0.7 + 0.6 * clump), against, exp(-x * 1.5)) * fall;
  // What rises tears the outer flame into licks; the whole of it flickers.
  heat *= 1.0 + (rise - 0.5) * 1.5 * smoothstep(0.25, 1.4, x) + (flick - 0.5) * 0.35;
  // (Nothing far beyond its reach.)
  heat *= 1.0 - smoothstep(2.4, 3.7, x);
  // Tongues: thin bright flames that rise from the outline where his stand tall, lean, curl over at the top, tear off
  // at the foot and are gone (index.ts gives each its foot, its height and its moment).
  for (int i = 0; i < TONGUES; i++) {
    vec4 ta = uTongueA[i];
    vec4 tb = uTongueB[i];
    if (tb.z <= 0.0) continue;
    vec2 r = p - ta.xy;
    float grown = ta.z * smoothstep(0.0, 0.3, tb.x);
    float hh = -r.y / max(grown, 1.0);
    if (hh < -0.06 || hh > 1.05) continue;
    float axis = ta.w * ta.z * (0.3 * hh * hh + 1.25 * pow(max(hh, 0.0), 4.0)) + sin(hh * 4.0 + t * 4.0 + tb.w) * 4.0 * hh;
    float across = r.x - axis;
    float w = tb.y * (1.0 - 0.78 * hh) + 0.7;
    float line = exp(-(across * across) / (w * w)) + 0.24 * exp(-(across * across) / (w * w * 30.0));
    float torn = smoothstep(0.0, 0.12, hh - (tb.x - 0.62) / 0.38 * 1.1);
    float held = smoothstep(-0.06, 0.06, hh) * (1.0 - smoothstep(0.5, 1.0, hh)) * torn * (1.0 - smoothstep(0.8, 1.0, tb.x));
    heat = max(heat, hot * 1.15 * tb.z * line * held);
  }
  heat *= 0.94 + 0.07 * sin(t * 2.3 + sector * 40.0) + 0.04 * sin(t * 1.1);
  heat *= 1.0 - smoothstep(0.82, 0.98, e);
  // (Nothing burns deep behind the medallion: when it goes, the painting is behind it, not a fire.)
  heat *= smoothstep(-0.6 * uRange.y, 0.0, d);
  // It catches where it was touched and runs round the outline from there.
  float gone = distance(p, uIgnite.xy) / uIgnite.z;
  float burns = smoothstep(0.0, 1.0, uBurn * 2.2 - gone * 1.2 + (rise - 0.5) * 0.25);
  // Left alone it smoulders: a low flame along a part of the outline, now and then; and a faint breath of warmth all round.
  for (int i = 0; i < 2; i++) {
    vec4 low = uPatch[i];
    burns = max(burns, low.w * (1.0 - smoothstep(0.4, 1.0, distance(p, low.xy) / low.z)) * (0.75 + 0.5 * rise));
  }
  heat *= max(burns, uBreath) * uFlare.x;
  // (Tearing away: what rises through it eats it into shreds.)
  heat = max(0.0, heat * (1.0 + uFlare.z) - uFlare.z * (0.25 + 1.1 * rise));
  heat = clamp(heat, 0.0, 1.0);
  vec4 c = texture(uRamp, vec2(heat * (uRampSteps - 1.0) / uRampSteps + 0.5 / uRampSteps, 0.5));
  // (A grain finer than a step of the display's own, so that the glow's slow fall shows no bands.)
  c.rgb += (hash(vec3(gl_FragCoord.xy, t)) - 0.5) / 255.0 * step(0.002, c.a + c.r);
  o = c;
}`;

/**
 * The model. Each vertex lies where its place on the at-rest cut is (so that, seen straight on, the model
 * shows the painting exactly), with its own height; it turns about the cut's middle.
 */
export const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform vec2 uBox;
uniform vec4 uCut;
uniform float uDepth;
uniform mat3 uTurn;
uniform float uScale;
uniform float uPush;
out vec2 vUv;
out vec3 vP;
out vec2 vS;
out vec3 vN;
out float vFront;
void main() {
  vec3 m = vec3((aUv.x - 0.5) * uCut.z, (0.5 - aUv.y) * uCut.w, aPos.z * uDepth);
  vec3 r = uTurn * m;
  r.xy *= uScale;
  r.z -= uPush;
  vec2 s = uCut.xy + uCut.zw * 0.5 + vec2(r.x, -r.y);
  vUv = aUv;
  vP = r;
  vS = s;
  vN = uTurn * aNormal;
  vFront = aNormal.z;
  gl_Position = vec4(s.x / uBox.x * 2.0 - 1.0, 1.0 - s.y / uBox.y * 2.0, -r.z / 1000.0, 1.0);
}`;

/**
 * At rest every pixel of the model is the at-rest cut's own pixel (its cover too); as it catches fire it
 * takes the ablaze sheet and becomes whole. Light only adds: the sweep's band and the pointer's light,
 * each a highlight through the relief, tinted by the painted colour and as strong as the part shines.
 */
export const MESH_FS = `#version 300 es
precision highp float;
uniform sampler2D uCard;
uniform sampler2D uAblaze;
uniform sampler2D uRelief;
uniform mat3 uTurn;
uniform float uBurn;
uniform float uTime;
uniform vec3 uIgnite;
uniform vec4 uSweep;
uniform float uSweepHigh;
uniform vec4 uPointer;
uniform vec3 uGoing;
uniform vec2 uSurge;
in vec2 vUv;
in vec3 vP;
in vec2 vS;
in vec3 vN;
in float vFront;
out vec4 o;
float glint(vec3 n, vec3 light, float rough) {
  vec3 h = normalize(light + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, h), 0.0);
  float a2 = rough * rough * rough * rough;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return (a2 * a2) / (d * d);
}
void main() {
  vec4 card = texture(uCard, vUv);
  vec3 ablaze = texture(uAblaze, vUv).rgb;
  float gone = distance(vS, uIgnite.xy) / uIgnite.z;
  float burn = smoothstep(0.0, 1.0, uBurn * 2.2 - gone * 1.2);
  burn *= 0.92 + 0.08 * sin(uTime * 11.0 + vUv.x * 23.0) * sin(uTime * 7.3 + vUv.y * 17.0);
  vec3 colour = mix(card.rgb, ablaze, burn);
  float cover = mix(card.a, 1.0, burn);

  vec3 relief = texture(uRelief, vUv).rgb;
  vec3 n = vec3(relief.xy * 2.0 - 1.0, 0.0);
  n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
  // A side wall, which the relief (drawn straight on) does not have, keeps the model's own normal.
  n = normalize(mix(normalize(vN), uTurn * n, smoothstep(0.15, 0.5, vFront)));
  float shine = relief.b;
  float rough = mix(0.52, 0.2, shine);
  vec3 paint = colour / max(cover, 1e-3);
  float bright = max(paint.r, max(paint.g, paint.b));
  vec3 tint = mix(vec3(1.0), paint / max(bright, 0.08), 0.75) * mix(0.3, 1.0, bright);

  vec3 light = vec3(0.0);
  if (uSweep.w > 0.0) {
    float along = dot(vP.xy, uSweep.xy) - uSweep.z;
    vec3 from = normalize(vec3(-along * uSweep.xy, uSweepHigh - vP.z));
    light += vec3(1.0, 0.93, 0.82) * uSweep.w * glint(n, from, rough);
    // While it burns, the band of light surges the glow of what it passes over: the burning edges brighter, and a
    // little of their light spilled on the metal round them; it travels with the band and eases back behind it.
    if (uSurge.x > 0.0) {
      float under = exp(-(along * along) / (uSurge.y * uSurge.y)) * uSurge.x * burn;
      vec3 glow = max(ablaze - card.rgb, 0.0);
      vec3 spill = max(textureLod(uAblaze, vUv, 3.5).rgb - textureLod(uCard, vUv, 3.5).rgb, 0.0);
      colour += (glow * 0.9 + spill * 1.5) * under;
    }
  }
  if (uPointer.w > 0.0) {
    vec3 to = vec3(uPointer.xy - vP.xy, uPointer.z - vP.z);
    light += vec3(1.0, 0.82, 0.6) * uPointer.w * glint(n, normalize(to), rough) / (1.0 + dot(to.xy, to.xy) / 160000.0);
  }
  // The press: a flash on the metal, and then it is gone.
  o = vec4(colour * (1.0 - 0.4 * uGoing.z) + (light * tint * shine + vec3(1.0, 0.82, 0.55) * uGoing.y * (0.25 + 0.5 * shine)) * cover, cover) * uGoing.x;
}`;

/** An ember: a square turned the way it flies, showing one shape of the picture of shapes. */
export const SPARK_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPlace;
layout(location = 2) in vec4 aLook;
uniform vec2 uBox;
uniform vec2 uGrid;
out vec2 vUv;
out float vShown;
void main() {
  vec2 c = (aCorner - 0.5) * aPlace.zw;
  vec2 along = aLook.xy;
  vec2 s = aPlace.xy + along * c.x + vec2(-along.y, along.x) * c.y;
  float column = mod(aLook.z, uGrid.x);
  float row = floor(aLook.z / uGrid.x);
  vUv = vec2((column + aCorner.x) / uGrid.x, (row + aCorner.y) / (uGrid.y * 2.0));
  vShown = aLook.w;
  gl_Position = vec4(s.x / uBox.x * 2.0 - 1.0, 1.0 - s.y / uBox.y * 2.0, 0.0, 1.0);
}`;

export const SPARK_FS = `#version 300 es
precision highp float;
uniform sampler2D uShapes;
in vec2 vUv;
in float vShown;
out vec4 o;
void main() {
  vec3 light = texture(uShapes, vUv).rgb;
  float cover = texture(uShapes, vUv + vec2(0.0, 0.5)).r;
  o = vec4(light, cover) * vShown;
}`;
