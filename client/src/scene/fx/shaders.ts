/**
 * The effects' shaders. Two things are drawn, each all its instances in one call:
 *
 * The decals: patches on the board, drawn over everything that lies on the table and under every
 * particle. A patch of light multiplies what is there (the board, a counter) by more than one, in
 * the light's colour, so that print stays print and only takes more light; soot and the shadows
 * of smoke multiply it by less than one.
 *
 * The particles: sprites in the air, the farthest first. A sprite is a frame of a flipbook (two
 * frames, blended, so that a flipbook played slowly does not step) or one of the shapes drawn
 * here (a glow, a streak, a chip, a puff, a muzzle's flash). Colour leaves the shader already
 * multiplied by cover, and one blend serves smoke (it covers) and fire (it adds) alike, which is
 * what lets smoke lie over fire and fire shine through smoke in whichever order they stand.
 *
 * Smoke is shaded as the board is: by the table's key light and the room, on a round normal, so a
 * puff is light on the side the board's own shadows say the light is on. Nothing is cut by the
 * board: a sprite is eased out where it would go under it. The grade and the vignette are the last
 * step here as in every surface's shader (`finish`).
 */
import { COMMON } from '../shaders';

export const DECAL_VERTEX = /* glsl */ `
attribute vec4 aSpot;   // x, y, reach, the light's height over the board
attribute vec4 aTone;   // light r, g, b (linear, at its strength); darkness
varying vec2 vOff;
varying vec4 vTone;
varying float vHeight;
void main() {
  vOff = position.xy * 2.0;
  vTone = aTone;
  vHeight = aSpot.w / max(aSpot.z, 1e-4);
  gl_Position = projectionMatrix * viewMatrix * vec4(aSpot.xy + position.xy * 2.0 * aSpot.z, 0.02, 1.0);
}
`;

export const DECAL_FRAGMENT = /* glsl */ `
varying vec2 vOff;
varying vec4 vTone;
varying float vHeight;
void main() {
  float d = length(vOff);
  float edge = 1.0 - smoothstep(0.5, 1.0, d);
  // A light a little above the board: brightest under it, falling as the square of the distance and the angle.
  float h = max(vHeight, 0.08);
  float fall = pow(1.0 + d * d / (h * h), -1.5) * edge;
  // Shade is soft all the way out.
  float shade = vTone.a * exp(-d * d * 3.2) * edge;
  // The picture on screen is already through the display's curve: light times (1 + l) there is light times this.
  vec3 gain = pow(1.0 + vTone.rgb * fall, vec3(1.0 / 2.2)) - 1.0;
  gl_FragColor = vec4(gain, 1.0 - pow(1.0 - clamp(shade, 0.0, 0.95), 1.0 / 2.2));
}
`;

export const SPRITE_VERTEX = /* glsl */ `
attribute vec4 aPlace;   // where it is; its width
attribute vec4 aAxis;    // stretched: the way it lies, times its length. w: its turn
attribute vec4 aFrames;  // the corners of the two frames it is between
attribute vec4 aCell;    // a frame's size; how far between the two; the atlas (0, 1) or a shape (under 0)
attribute vec4 aInk;     // colour (linear), cover
attribute vec4 aLook;    // how much it hides; how much brighter than pictured; how much it takes the table's light; height over width
attribute vec4 aMore;    // how it is turned (0 to the camera, 1 standing, 2 stretched); a seed; warmth; share of its life gone
attribute vec4 aLast;    // the frame's pivot; how its picture is taken; mirrored (-1) or not (1)
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamPos;
uniform vec4 uUpright;   // the way a standing sprite's up points; the share of its height it is drawn at
varying vec2 vQuad;
varying vec2 vBall;
varying vec3 vWorld;
varying vec4 vFrames;
varying vec4 vCell;
varying vec4 vInk;
varying vec4 vLook;
varying vec4 vMore;
varying vec4 vLast;
void main() {
  vec2 c = position.xy;
  float w = aPlace.w;
  vec3 world;
  vBall = c * 2.0;
  if (aMore.x > 1.5) {
    float len = length(aAxis.xyz);
    vec3 dir = len > 1e-5 ? aAxis.xyz / len : vec3(1.0, 0.0, 0.0);
    vec3 side = cross(dir, normalize(uCamPos - aPlace.xyz));
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : uCamRight;
    world = aPlace.xyz - dir * (0.5 - c.y) * len + side * c.x * w;
  } else if (aMore.x > 0.5) {
    vec3 up = uUpright.xyz;
    vec3 right = cross(up, normalize(uCamPos - aPlace.xyz));
    float rl = length(right);
    right = rl > 1e-4 ? right / rl : uCamRight;
    float h = w * aLook.w * uUpright.w;
    world = aPlace.xyz + right * (c.x - (aLast.x - 0.5) * aLast.w) * w + up * (c.y + 0.5 - (1.0 - aLast.y)) * h;
  } else {
    float cs = cos(aAxis.w);
    float sn = sin(aAxis.w);
    vec2 off = vec2(c.x - (aLast.x - 0.5) * aLast.w, (c.y - (0.5 - aLast.y)) * aLook.w);
    vec2 r = vec2(off.x * cs - off.y * sn, off.x * sn + off.y * cs);
    vBall = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * 2.0;
    world = aPlace.xyz + (uCamRight * r.x + uCamUp * r.y) * w;
  }
  vQuad = c;
  vWorld = world;
  vFrames = aFrames;
  vCell = aCell;
  vInk = aInk;
  vLook = aLook;
  vMore = aMore;
  vLast = aLast;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const SPRITE_FRAGMENT = /* glsl */ `
varying vec2 vQuad;
varying vec2 vBall;
varying vec3 vWorld;
varying vec4 vFrames;
varying vec4 vCell;
varying vec4 vInk;
varying vec4 vLook;
varying vec4 vMore;
varying vec4 vLast;
${COMMON}
uniform sampler2D uAtlasA;
uniform sampler2D uAtlasB;
uniform vec4 uTexel;     // half a texel of the first atlas, and of the second
uniform vec4 uSmoke;     // the room's share of smoke's light; the key's; how far round a puff the key wraps; the height a sprite is eased out over
uniform vec3 uWarm;      // a fire's light on the smoke over it
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamBack;

vec4 frame(vec2 corner, vec2 inCell, vec2 dx, vec2 dy) {
  vec2 uv = corner + inCell;
  return vCell.w < 0.5 ? textureGrad(uAtlasA, uv, dx, dy) : textureGrad(uAtlasB, uv, dx, dy);
}

/** The table's light on a round puff, seen at this point of its disc. 1 is the light on the board. */
float puffLight() {
  vec2 b = vBall * 0.86;
  vec3 n = vec3(b, sqrt(max(0.0, 1.0 - dot(b, b))));
  vec3 N = normalize(uCamRight * n.x + uCamUp * n.y + uCamBack * n.z);
  float d = dot(N, uKeyDir);
  float key = clamp((d + uSmoke.z) / (1.0 + uSmoke.z), 0.0, 1.0);
  return mix(1.0, uSmoke.x + uSmoke.y * key, uLight.z);
}

void main() {
  float shape = vCell.w;
  float alpha = vInk.a;
  vec3 ink = vInk.rgb;
  float opacity = vLook.x;
  float gain = vLook.y;
  float cover = 0.0;
  vec3 col = vec3(0.0);
  float soft = 1.0;

  if (shape > -0.5) {
    // A frame of a flipbook, and the next, blended.
    vec2 uvq = vec2(vQuad.x * vLast.w + 0.5, 0.5 - vQuad.y);
    vec2 edge = shape < 0.5 ? uTexel.xy : uTexel.zw;
    vec2 inCell = clamp(uvq * vCell.xy, edge, vCell.xy - edge);
    vec2 dx = dFdx(inCell);
    vec2 dy = dFdy(inCell);
    vec4 t = mix(frame(vFrames.xy, inCell, dx, dy), frame(vFrames.zw, inCell, dx, dy), vCell.z);
    // Colour comes multiplied by cover and can be no brighter than it: what the encoder left under no cover is dropped here.
    t.rgb = min(t.rgb, vec3(t.a));
    cover = t.a;
    vec3 c = pow(t.rgb / max(cover, 1e-3), vec3(2.2));
    float lum = dot(c, vec3(0.3, 0.59, 0.11));
    float mode = vLast.z;
    if (mode < 0.5) {
      // Smoke and dust: the picture gives the folds, the ink the colour, the table the light.
      float folds = mix(1.0, clamp(lum / 0.19, 0.3, 2.1), 0.8);
      float below = mix(1.0, 1.7 * (1.0 - smoothstep(-0.7, 0.5, vBall.y)), clamp(uCamUp.z, 0.0, 1.0));
      col = ink * folds * mix(1.0, puffLight(), vLook.z) + uWarm * vMore.z * below * folds * 0.5;
    } else if (mode < 1.5) {
      // Fire and its smoke as pictured: the fire brighter than the picture can say, the smoke in the table's light.
      float fire = clamp(max((c.r - c.b) * 2.6, smoothstep(0.42, 0.8, lum)), 0.0, 1.0);
      col = c * ink * mix(mix(1.0, puffLight(), vLook.z), gain, fire);
      opacity = mix(1.0, opacity, fire);
    } else {
      // Light on black: its hue, as bright as it covers. Where it hardly covers, its hue is not to be
      // trusted (it is a quotient of two small numbers), so its thin rim is let go.
      cover *= smoothstep(0.02, 0.32, cover);
      col = c * ink * gain;
    }
    soft = smoothstep(-0.01, uSmoke.w * (vMore.x > 0.5 ? 0.4 : 1.0), vWorld.z);
  } else if (shape > -1.5) {
    // A glow: light only, soft to its edge.
    float r2 = dot(vBall, vBall);
    cover = max(0.0, exp(-r2 * 3.4) - 0.0334) * 1.03;
    col = mix(ink, vec3(1.0), 0.55 * cover * cover);
  } else if (shape > -2.5) {
    // A streak: a hot head and a tail that thins and fades.
    float s = abs(vBall.x);
    float t = vQuad.y + 0.5;
    float wide = mix(0.28, 1.0, smoothstep(0.0, 0.85, t));
    cover = (1.0 - smoothstep(0.22 * wide, wide, s)) * smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float core = (1.0 - smoothstep(0.0, 0.5 * wide, s)) * smoothstep(0.25, 0.9, t) * smoothstep(0.08, 0.4, max(ink.r, max(ink.g, ink.b)));
    col = mix(ink, vec3(1.0, 0.97, 0.9), 0.55 * core);
  } else if (shape > -3.5) {
    // A chip: a small dark irregular thing.
    float a = atan(vBall.y, vBall.x);
    float r = length(vBall * vec2(1.0, 1.5)) * (1.0 + 0.12 * sin(a * 3.0 + vMore.y * 40.0) + 0.08 * sin(a * 5.0 + vMore.y * 17.0));
    cover = 1.0 - smoothstep(0.6, 0.9, r);
    col = ink * mix(1.0, 0.75 + 0.5 * vBall.y * uCamUp.z, uLight.z);
  } else if (shape > -4.5) {
    // A puff the shader draws itself, where there is no picture to draw.
    vec4 n = texture2D(uNoise, vBall * 0.21 + vec2(vMore.y * 7.3, vMore.y * 3.1));
    float r = length(vBall) + (n.r - 0.5) * 0.7;
    cover = (1.0 - smoothstep(0.35, 0.95, r)) * (0.75 + 0.5 * n.b);
    // Standing in for smoke it takes the table's light; standing in for fire (a picture that would glow) it is fire's colours.
    vec3 smoke = ink * (0.8 + 0.4 * n.g) * mix(1.0, puffLight(), vLook.z) + uWarm * vMore.z * 0.4;
    vec3 fire = ink * mix(vec3(1.0, 0.4, 0.08), vec3(1.0, 0.86, 0.5), n.g * (1.0 - r)) * 1.5;
    col = vLast.z > 0.5 ? fire : smoke;
    soft = smoothstep(-0.01, uSmoke.w, vWorld.z);
  } else {
    // A muzzle's flash: a ragged tongue of fire from the muzzle (the quad's foot) to its tip.
    float s = abs(vBall.x);
    float t = vQuad.y + 0.5;
    vec4 n = texture2D(uNoise, vec2(t * 0.35 + vMore.y * 5.0, vBall.x * 0.22 + vMore.y * 9.0));
    float wide = sin(3.14159 * pow(clamp(t, 0.0, 1.0), 0.62)) * (0.62 + 0.7 * n.r);
    cover = (1.0 - smoothstep(0.3 * wide, wide, s)) * smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.55, 1.0, t));
    float core = (1.0 - smoothstep(0.0, 0.5 * wide, s)) * (1.0 - smoothstep(0.1, 0.75, t));
    col = mix(ink * vec3(1.0, 0.5, 0.16), ink, cover);
    col = mix(col, vec3(1.0, 0.98, 0.92), 0.85 * core) * gain;
  }

  float a = cover * alpha * soft;
  if (a < 0.002) discard;
  gl_FragColor = vec4(finish(col).rgb * a, a * opacity);
}
`;
