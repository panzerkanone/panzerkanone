/**
 * The things on the table: their surfaces, lit as everything on the table is (the scene's shared uniforms and
 * `finish`), and their soft shadows multiplied onto the table. Every printed or natural surface is drawn here
 * from a few numbers and its uv: no pictures.
 */
import { COMMON } from '../shaders';

export const PROP_VERTEX = /* glsl */ `
attribute vec3 aAlbedo;
attribute vec4 aSurf;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vAlbedo;
varying vec4 vSurf;
void main() {
  vec4 p = modelMatrix * vec4(position, 1.0);
  vPos = p.xyz;
  vNormal = normal;
  vUv = uv;
  vAlbedo = aAlbedo;
  vSurf = aSurf;
  gl_Position = projectionMatrix * viewMatrix * p;
}
`;

export const PROP_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vAlbedo;
varying vec4 vSurf;
${COMMON}
uniform vec4 uSheen;
uniform vec3 uWinDir;
uniform vec4 uTableSheen;

/** A line across uv: 1 on it, soft over a pixel. */
float rule(float d, float w) {
  float px = max(fwidth(d), 1e-5);
  return 1.0 - smoothstep(w, w + px, abs(d));
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vPos);
  int kind = int(vSurf.x + 0.5);
  float gloss = vSurf.y;
  float metal = vSurf.z;
  float sharp = vSurf.w;
  vec3 alb = vAlbedo;
  vec2 uv = vUv;
  if (kind == 1) {
    // A drink can's label: its own colour, a pale band round it with a thin dark rule each side, and a stripe.
    float v = uv.y / 6.1;
    float band = step(0.5, v) * step(v, 0.66);
    alb = mix(alb, vec3(0.80, 0.78, 0.74), band);
    alb = mix(alb, alb * 0.25, max(rule(v - 0.5, 0.006), rule(v - 0.66, 0.006)));
    float stripe = step(0.2, v) * step(v, 0.26);
    alb = mix(alb, mix(alb, vec3(1.0), 0.55), stripe);
  } else if (kind == 3) {
    // A rule card: cream stock, a coloured head, a ruled border, and lines of small print as grey dashes.
    vec3 stock = vec3(0.86, 0.82, 0.72);
    vec3 head = alb;
    alb = stock;
    float border = max(max(rule(uv.x - 0.06, 0.004), rule(uv.x - 0.94, 0.004)), max(rule(uv.y - 0.05, 0.003), rule(uv.y - 0.95, 0.003)));
    alb = mix(alb, head, step(0.82, uv.y) * step(uv.y, 0.93) * step(0.08, uv.x) * step(uv.x, 0.92));
    float line = fract(uv.y * 26.0);
    float words = step(0.45, fract(uv.x * 7.0 + floor(uv.y * 26.0) * 0.37)) * 0.6 + 0.4;
    float print = step(0.1, uv.y) * step(uv.y, 0.78) * step(0.1, uv.x) * step(uv.x, 0.9) * (1.0 - smoothstep(0.22, 0.3, line)) * words;
    alb = mix(alb, vec3(0.35, 0.33, 0.3), 0.5 * print);
    alb = mix(alb, head * 0.8, border);
  } else if (kind == 4) {
    // A notepad's page: pale blue rules and a red margin.
    alb = vec3(0.87, 0.85, 0.78);
    float lines = rule(fract(uv.y * 22.0) - 0.5, 0.02) * step(0.06, uv.y) * step(uv.y, 0.86);
    alb = mix(alb, vec3(0.45, 0.6, 0.78), 0.6 * lines);
    alb = mix(alb, vec3(0.8, 0.3, 0.3), 0.7 * rule(uv.x - 0.14, 0.003));
  } else if (kind == 5) {
    // The edge of a pile of paper: fine light and dark leaves.
    alb = vec3(0.8, 0.78, 0.72) * (0.85 + 0.15 * step(0.5, fract(uv.y * 40.0)));
  } else if (kind == 6) {
    // Cork: specks of light and dark in a warm brown.
    vec4 n = texture2D(uNoise, vPos.xy * 2.3);
    vec4 m = texture2D(uNoise, vPos.xy * 7.1 + 0.3);
    alb *= 0.75 + 0.5 * n.r;
    alb *= 1.0 - 0.45 * smoothstep(0.7, 0.85, m.g);
    alb = mix(alb, alb * 1.5, smoothstep(0.75, 0.9, m.b));
  } else if (kind == 9) {
    // A folded rule sheet: two columns of small print under a heading.
    float col = uv.x < 0.5 ? (uv.x - 0.06) / 0.4 : (uv.x - 0.54) / 0.4;
    float line = fract(uv.y * 34.0);
    float words = step(0.4, fract(col * 6.0 + floor(uv.y * 34.0) * 0.53)) * 0.6 + 0.4;
    float print = step(0.0, col) * step(col, 1.0) * step(0.08, uv.y) * step(uv.y, 0.8) * (1.0 - smoothstep(0.2, 0.32, line)) * words;
    alb = mix(alb, vec3(0.3, 0.28, 0.26), 0.55 * print);
    alb = mix(alb, vec3(0.2, 0.18, 0.17), step(0.86, uv.y) * step(uv.y, 0.92) * step(0.06, uv.x) * step(uv.x, 0.6));
  }

  // ---- the light: the key and the room, as on the counters ------------------------------------------------
  float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
  float sky = 0.5 + 0.5 * N.z;
  float light = uLight.x * key + (1.0 - uLight.x) * sky;
  // A metal's colour is in its reflections, not in its diffuse light.
  vec3 col = alb * light * (1.0 - 0.75 * metal);
  // ---- reflections: the key, the window, the lamp, and the room, by how glossy and how metallic ----------------
  vec3 R = reflect(-V, N);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float F = mix(0.04, 0.9, metal) + (1.0 - mix(0.04, 0.9, metal)) * pow(1.0 - nv, 5.0);
  float k = sharp;
  float spec = uTableSheen.x * 6.0 * exp(-k * (1.0 - dot(R, uKeyDir)))
    + uTableSheen.y * 2.0 * exp(-0.25 * k * (1.0 - dot(R, uWinDir)))
    + uLampB.y * 160.0 * exp(-0.5 * k * (1.0 - dot(R, normalize(uLamp.xyz - vPos))));
  // The room in a reflection: the dark floor below, the bright windows and walls about the horizon, the ceiling above.
  float room = 0.08 + 0.55 * smoothstep(-0.15, 0.25, R.z) - 0.2 * smoothstep(0.45, 0.95, R.z);
  vec3 tint = mix(vec3(1.0), alb, metal);
  col += gloss * F * (spec + room) * tint * vec3(1.0, 0.97, 0.92);
  col *= lampPool(vPos);
  gl_FragColor = finish(col);
}
`;

/** The shadows: a quad under each thing, made a soft capsule or a soft box by its numbers, multiplied onto the table. */
export const PROP_SHADOW_VERTEX = /* glsl */ `
attribute vec4 aLocal;  // where this point is in the thing's own frame (h); how far its top's shadow reaches, in that frame
attribute vec4 aShape;  // its half size (a radius, 0 for a round thing; or a half length and width); 0 round, 1 box; strength
varying vec4 vLocal;
varying vec4 vShape;
void main() {
  vLocal = aLocal;
  vShape = aShape;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const PROP_SHADOW_FRAGMENT = /* glsl */ `
varying vec4 vLocal;
varying vec4 vShape;
uniform vec4 uLight;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
void main() {
  vec2 p = vLocal.xy;
  vec2 off = vLocal.zw;
  float shade = 0.0;
  // Along the shadow from the foot to the top's: softer and lighter the further from the foot.
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    vec2 q = p - off * t;
    float d = vShape.z < 0.5 ? length(q) - vShape.x : sdBox(q, vShape.xy);
    float w = 0.06 + 0.5 * t * length(off) * 0.12;
    shade = max(shade, (1.0 - smoothstep(-w, w, d)) * (1.0 - 0.45 * t));
  }
  // The foot: a little dark close round it whichever way the light comes.
  float foot = vShape.z < 0.5 ? length(p) - vShape.x : sdBox(p, vShape.xy);
  shade = max(shade, 0.6 * exp(-max(foot, 0.0) / 0.12));
  float keep = 1.0 - vShape.w * shade * (uLight.y > 0.5 ? 1.0 : 0.0);
  gl_FragColor = vec4(vec3(keep), 1.0);
}
`;
