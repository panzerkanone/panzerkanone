/**
 * The briefing room's live light (client/src/campaign/roomfx.ts draws with these). Places are stage pixels, x across
 * and y down from the room's top left corner. Every colour is written as light already weighed by its cover
 * (premultiplied), so that it adds to the owner's painting under the canvas without a dark fringe.
 */

/** Smooth noise read from the noise picture (256 by 256, four unrelated values a texel, tiling). */
const NOISE = `
vec4 vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 256.0, 0.0);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * vn(p).r;
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

const HASH = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
`;

/** The whole canvas, with each pixel's place in stage pixels. */
export const FULL_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec2 uBox;
out vec2 vAt;
void main() {
  vAt = aCorner * uBox;
  gl_Position = vec4(aCorner.x * 2.0 - 1.0, 1.0 - aCorner.y * 2.0, 0.0, 1.0);
}`;

/** A rectangle of the stage (uRect: x, y, width, height). */
export const RECT_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec2 uBox;
uniform vec4 uRect;
out vec2 vAt;
out vec2 vUv;
void main() {
  vAt = uRect.xy + aCorner * uRect.zw;
  vUv = aCorner;
  gl_Position = vec4(vAt.x / uBox.x * 2.0 - 1.0, 1.0 - vAt.y / uBox.y * 2.0, 0.0, 1.0);
}`;

/**
 * The room's air: smoke, and the light that shows it. The room is dark and stays dark: smoke is seen only where
 * light passes through it. Drawn small (the smoke is soft) and laid over the room by AIR_OVER_FS. At each pixel:
 * how much smoke hangs there (billows with gaps between them, warped, rising slowly; gathered low behind the table at
 * the left and round the crate, thin elsewhere); the ceiling lamp's cone in it; the projector's beam (from the lens
 * to the picture on the screen, opening exactly to the picture's edges: even along its length, a fuller middle, soft
 * edges; in it, rays that are the film's own rows of light and dark and finer rays that shimmer with the lamp's
 * flutter); and the light the lit screen gives back, which finds the low smoke near it.
 */
export const AIR_FS = `#version 300 es
precision highp float;
uniform sampler2D uNoise;
uniform sampler2D uFilm;
uniform float uTime;
uniform vec4 uBeam;
uniform vec2 uLens;
uniform vec4 uPic;
uniform vec3 uLamp;
in vec2 vAt;
out vec4 o;
${NOISE}
// How the smoke is pushed about at a place: two slow, unrelated pulls (worked out once a pixel, and shared).
vec2 pull(vec2 p, float t) {
  vec2 q = p / 430.0 * 0.7;
  vec4 a = vn(q + vec2(t * 0.012, t * 0.005));
  vec4 b = vn(q * 2.03 + vec2(17.3 - t * 0.009, 9.1 + t * 0.011));
  return vec2(a.r * 0.67 + b.r * 0.33, a.g * 0.67 + b.g * 0.33) - 0.5;
}
// Billows with gaps between them, rising slowly.
float billow(vec2 p, float t, vec2 w) {
  vec2 q = p / 430.0 + vec2(0.0, t * 0.006);
  float d = fbm(q + w * 2.2 + vec2(-t * 0.018, 0.0));
  float fine = fbm(q * 2.7 + w * 3.0 + vec2(t * 0.033, t * 0.02));
  return smoothstep(0.3, 0.74, d * 0.7 + fine * 0.3);
}
float blob(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / r;
  return exp(-dot(d, d));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 p = vAt;
  float t = uTime;
  vec2 w = pull(p, t);
  float smoke = billow(p, t, w);
  // Where it gathers.
  float low = blob(p, vec2(300.0, 975.0), vec2(430.0, 105.0)) + 0.45 * blob(p, vec2(900.0, 960.0), vec2(330.0, 70.0));
  float side = 0.8 * blob(p, vec2(1480.0, 955.0), vec2(150.0, 90.0)) + 0.9 * blob(p, vec2(1900.0, 900.0), vec2(170.0, 160.0));
  float gathered = clamp(low + side, 0.0, 1.2);
  float thick = smoke * (0.16 + gathered);

  // The room's own light in it: next to nothing. The lit screen's: warm, and near.
  float rowAll = luma(textureLod(uFilm, vec2(0.5, 0.5), 10.0).rgb);
  vec2 fromScreen = (p - vec2(uPic.x + uPic.z * 0.5, uPic.y + uPic.w)) / vec2(560.0, 300.0);
  float back = exp(-length(fromScreen) * 1.25) * uBeam.x * uBeam.z * (0.35 + 1.6 * rowAll);
  vec3 light = vec3(0.19, 0.2, 0.235) * 0.5 * thick + vec3(0.95, 0.9, 0.8) * 1.2 * back * thick;
  float cover = 0.16 * thick;

  // The ceiling lamp: a cone straight down, and the smoke turning in it.
  vec2 lr = p - uLamp.xy;
  float ly = max(lr.y, 0.0);
  float spread = 105.0 + ly * 0.64;
  float lampReach = exp(-(lr.x * lr.x) / (spread * spread)) * exp(-ly / 215.0) * smoothstep(-8.0, 6.0, lr.y);
  // (Only where the lamp reaches is its smoke worked out.)
  float lampSmoke = lampReach > 0.004 ? billow(p * 1.35 + vec2(410.0, 77.0), t * 1.2, w) : 0.0;
  float lampRays = 0.9 + 0.2 * textureLod(uNoise, vec2(atan(lr.x, ly + 60.0) * 0.6 + t * 0.0011, 0.13), 1.0).a;
  float lamp = lampReach * lampRays;
  light += vec3(1.0, 0.93, 0.82) * uLamp.z * lamp * (0.35 + 1.6 * lampSmoke);
  cover += 0.1 * lamp * uLamp.z * (0.4 + lampSmoke);

  // The beam. v runs across it, top to bottom, as the film's rows do; its edges run to the picture's own corners.
  vec2 r = p - uLens;
  float dist = length(r);
  vec2 tr = vec2(uPic.x + uPic.z, uPic.y) - uLens;
  vec2 br = vec2(uPic.x + uPic.z, uPic.y + uPic.w) - uLens;
  float aT = atan(tr.y, -tr.x);
  float aB = atan(br.y, -br.x);
  float v = (atan(r.y, -r.x) - aT) / (aB - aT);
  // In front of the picture itself the beam is what has not yet landed: it thins toward the picture's far edge.
  float past = clamp((uPic.x + uPic.z - p.x) / uPic.z, 0.0, 1.0);
  v = mix(v, (p.y - uPic.y) / uPic.w, step(0.0001, past));
  float soft = mix(0.06, 0.22, clamp(dist / 520.0, 0.0, 1.0));
  float edge = smoothstep(0.0, soft, v) * (1.0 - smoothstep(1.0 - soft, 1.0, v)) * step(r.x, 0.0);
  float off = (v - 0.55) / 0.4;
  float full = exp(-off * off);
  float fall = pow(200.0 / (dist + 200.0), 0.35) * (1.0 - smoothstep(0.0, 0.5, past));
  float beam = 0.0;
  if (edge > 0.001 && fall > 0.001) {
    // Rays: the film's rows (a bright sky throws a brighter sheet of light), and the smoke's own streaks, which
    // shimmer sideways with the lamp's flutter and drift slowly. Soft at the lens, lost in the smoke further out.
    float row = 0.25 * (luma(textureLod(uFilm, vec2(0.125, v), 4.5).rgb) + luma(textureLod(uFilm, vec2(0.375, v), 4.5).rgb) + luma(textureLod(uFilm, vec2(0.625, v), 4.5).rgb) + luma(textureLod(uFilm, vec2(0.875, v), 4.5).rgb));
    float rows = mix(1.0, clamp(0.6 + 0.4 * row / max(rowAll, 0.06), 0.7, 1.35), uBeam.z * 0.6);
    float lod = clamp(dist / 170.0, 0.0, 3.2);
    float ray1 = textureLod(uNoise, vec2(v * 0.105 + t * 0.0021 + uBeam.w * 0.0016, 0.31), lod).g;
    float ray2 = textureLod(uNoise, vec2(v * 0.36 - t * 0.0043 - uBeam.w * 0.0034, 0.73), lod + 0.6).b;
    float sharp = smoothstep(10.0, 190.0, dist) * (1.0 - 0.55 * clamp(dist / 480.0, 0.0, 1.0));
    float rays = mix(1.0, 0.62 + 0.48 * ray1 + 0.3 * ray2, sharp) * rows;
    float inBeam = billow(p * 1.15 + vec2(90.0, 300.0), t * 1.4, w);
    beam = 0.6 * uBeam.x * edge * (0.5 + 0.5 * full) * fall * rays * (0.55 + 0.9 * inBeam);
  }
  // At the lens: a small glow, no more.
  float glow = uBeam.x * (0.8 * exp(-dist * dist / 90.0) + 0.12 * exp(-dist / 24.0));
  vec3 warm = mix(vec3(1.0, 0.975, 0.9), vec3(0.95, 0.92, 0.84), clamp(dist / 420.0, 0.0, 1.0));
  light += warm * (beam + glow);
  cover += 0.16 * beam;

  o = vec4(light, clamp(cover, 0.0, 0.85));
}`;

/**
 * The air laid over the room, by the room's depth (the mask: white the back of the room, black the table and what
 * stands on it, grey between): the smoke and the beam lie behind what is near. A grain finer than a step of the
 * display's own keeps the slow falls of light free of bands.
 */
export const AIR_OVER_FS = `#version 300 es
precision highp float;
uniform sampler2D uAir;
uniform sampler2D uFar;
uniform vec2 uBox;
uniform float uTime;
in vec2 vAt;
out vec4 o;
${HASH}
void main() {
  vec2 uv = vAt / uBox;
  vec4 air = texture(uAir, vec2(uv.x, 1.0 - uv.y));
  float far = texture(uFar, uv).r;
  vec4 c = air * (0.04 + 0.96 * far);
  c.rgb += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0 * step(0.002, c.a + c.r);
  o = c;
}`;

/**
 * The film on the pull-down screen: the loop's frame printed through the screen's own paper (its stains and creases
 * show in the picture), toned warm, with the old film's weave in the gate, its grain, a scratch now and then, the
 * lamp's flutter, a hot middle, dark corners and soft, rounded edges.
 */
export const FILM_FS = `#version 300 es
precision highp float;
uniform sampler2D uFilm;
uniform sampler2D uPaper;
uniform vec4 uPic;
uniform vec4 uGate;
uniform vec2 uShow;
uniform vec2 uFit;
uniform vec4 uPaperRect;
uniform vec4 uScreen;
in vec2 vAt;
in vec2 vUv;
out vec4 o;
${HASH}
void main() {
  vec2 uv = (vAt - uPic.xy) / uPic.zw;
  // Soft, rounded edges (the gate's shadow, out of focus).
  float radius = 42.0;
  vec2 q = abs(vAt - (uPic.xy + uPic.zw * 0.5)) - (uPic.zw * 0.5 - radius);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float edge = 1.0 - smoothstep(-13.0, 9.0, sd);
  // The screen round the picture: with the film running the room's lamps are low, and the bare paper is dim, as he
  // painted it (his finished screen is darker round the picture than his empty one).
  vec2 s2 = abs(vAt - (uScreen.xy + uScreen.zw * 0.5)) - uScreen.zw * 0.5;
  float dim = 0.36 * (1.0 - smoothstep(-26.0, 0.0, max(s2.x, s2.y))) * uShow.x;
  if (edge <= 0.0) {
    o = vec4(0.0, 0.0, 0.0, dim);
    return;
  }
  float frame = uGate.w;
  // The weave: the frame never sits twice in the same place.
  vec2 fuv = (uv - 0.5) * 0.985 * uFit + 0.5 + uGate.xy / uPic.zw;
  vec3 film = texture(uFilm, fuv).rgb;
  // (The loop is toned warm as it is cut: its red is its grey.)
  float l = film.r;
  // Grain, new on every frame of the film; coarser clumps under it.
  l += (hash(vec3(floor(vAt * 0.9), frame)) - 0.5) * 0.06 + (hash(vec3(floor(vAt * 0.31), frame + 7.0)) - 0.5) * 0.03;
  // A scratch or two, each for a few frames; a speck of dust for one.
  for (int k = 0; k < 2; k++) {
    float life = floor(frame / (5.0 + float(k) * 4.0));
    float sx = hash(vec3(life, float(k) * 3.1, 1.7));
    float on = step(0.62, hash(vec3(life, float(k), 9.2)));
    float wob = (hash(vec3(frame, life, 2.0)) - 0.5) * 0.004;
    l += on * (0.1 - 0.2 * step(0.5, hash(vec3(life, 4.0, float(k))))) * (1.0 - smoothstep(0.0, 0.0022, abs(uv.x - sx - wob)));
  }
  vec2 speck = vec2(hash(vec3(frame, 1.0, 5.0)), hash(vec3(frame, 2.0, 5.0)));
  l -= 0.5 * step(0.7, hash(vec3(frame, 3.0, 5.0))) * (1.0 - smoothstep(0.0, 0.012, length((uv - speck) * vec2(1.0, uPic.w / uPic.z))));
  l = clamp(pow(max(l * uShow.y, 0.0), 0.8) * 1.25, 0.0, 1.0);
  float tone = mix(l, l * l * (3.0 - 2.0 * l), 0.6);
  // A hot middle, dark corners.
  vec2 m = (uv - vec2(0.52, 0.47)) * vec2(1.0, 0.9);
  float lit = (1.0 - 0.2 * smoothstep(0.25, 0.8, length(m))) * uGate.z;
  // Light on paper: the paper's own colour, darker where the film is dense, brighter than the room where it is clear.
  vec3 paper = texture(uPaper, (vAt - uPaperRect.xy) / uPaperRect.zw).rgb;
  // (His picture is a bright, slightly washed sepia: the blacks never close.)
  vec3 colour = paper * mix(vec3(0.28, 0.255, 0.23), vec3(1.46, 1.43, 1.36), tone) * lit;
  float a = edge * uShow.x;
  o = vec4(colour * a, a + (1.0 - a) * dim);
}`;

/** A picture laid where it stands: a cut of the owner's painting (the projector's body, a little warmer as the lamp flutters), or the mechanism as this canvas drew it. */
export const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPicture;
uniform vec3 uTint;
uniform float uTurned;
uniform vec2 uSoft;
in vec2 vUv;
out vec4 o;
void main() {
  // (A picture this canvas drew itself has its first row at the foot.)
  vec2 uv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uTurned));
  vec4 c = texture(uPicture, uv);
  // The mechanism is a little soft, as his painted projector is (it stands back in the room, out of the sharpest focus).
  if (uSoft.x > 0.0) {
    c = c * 0.36 + 0.16 * (texture(uPicture, uv + vec2(uSoft.x, 0.0)) + texture(uPicture, uv - vec2(uSoft.x, 0.0)) + texture(uPicture, uv + vec2(0.0, uSoft.y)) + texture(uPicture, uv - vec2(0.0, uSoft.y)));
  }
  o = vec4(c.rgb * uTint, c.a);
}`;

/**
 * A part of the projector's mechanism (the model: tools/campaignart/build_reels.py). Its own frame is turned to the
 * viewer's (x right, y up, z toward the viewer) and set down on the stage; nothing recedes (the parts are small and
 * far off, as his painting has them).
 */
export const PART_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform vec4 uRect;
uniform mat3 uTurn;
uniform vec3 uPlace;
uniform vec3 uScale;
out vec3 vN;
out vec3 vLocal;
out vec2 vUv;
void main() {
  vec3 r = uTurn * (aPos * uScale);
  // (Drawn into a picture of the mechanism's own box, uRect, which is then laid on the stage.)
  vec2 s = (uPlace.xy + vec2(r.x, -r.y) - uRect.xy) / uRect.zw;
  vN = uTurn * (aNormal / uScale);
  vLocal = aPos;
  vUv = aUv;
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, -(r.z + uPlace.z) / 4000.0, 1.0);
}`;

/**
 * Lit as his projector is painted: the room's dim cool light, the ceiling lamp from above and to the left, the
 * window's blue from the right, and the projector's own lamp leaking from the lamp house below, which flutters.
 * The texture coordinate's v says what the surface is: painted metal, bare metal, or film (wound film shows its
 * turns; a running strip shows its perforations going by).
 */
export const PART_FS = `#version 300 es
precision highp float;
uniform vec3 uLight;
uniform vec2 uRun;
in vec3 vN;
in vec3 vLocal;
in vec2 vUv;
out vec4 o;
float shine(vec3 n, vec3 l, float tight) {
  return pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), tight);
}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float bare = step(0.25, vUv.y) * (1.0 - step(0.75, vUv.y));
  float film = step(0.75, vUv.y);
  vec3 base = mix(mix(vec3(0.262, 0.266, 0.275), vec3(0.6, 0.59, 0.57), bare), vec3(0.1, 0.094, 0.09), film);
  float tight = mix(mix(14.0, 48.0, bare), 30.0, film);
  float gloss = mix(mix(0.16, 0.6, bare), 0.3, film);
  if (film > 0.5) {
    // Wound film: its turns, fine rings. A running strip: perforations along one edge, frame lines across.
    float turns = 0.78 + 0.3 * fract(length(vLocal.xy) * 23.0);
    float along = vUv.x * uRun.x - uRun.y;
    float hole = step(0.55, fract(along)) * step(vLocal.z, -0.045);
    float line = step(0.9, fract(along * 0.5)) * 0.35;
    base = mix(base * turns, base * (1.0 + 3.2 * hole + line), step(0.5, uRun.x));
  }
  vec3 lampAt = normalize(vec3(-0.4, 0.78, 0.5));
  vec3 windowAt = normalize(vec3(0.75, 0.15, 0.4));
  vec3 houseAt = normalize(vec3(-0.35, -0.75, 0.55));
  vec3 lamp = vec3(1.0, 0.94, 0.86) * 0.5;
  vec3 window = vec3(0.5, 0.62, 0.9) * 0.55;
  vec3 house = vec3(1.0, 0.82, 0.58) * uLight.x;
  vec3 colour = base * (vec3(0.5, 0.53, 0.6) * uLight.y
    + lamp * max(dot(n, lampAt), 0.0) + window * max(dot(n, windowAt), 0.0) + house * max(dot(n, houseAt), 0.0));
  // The flanges are pressed metal: a little darker toward the hub, a touch of light along the rim.
  float fromHub = length(vLocal.xy);
  colour *= 0.86 + 0.2 * smoothstep(0.2, 1.0, fromHub) * (1.0 - film);
  colour += gloss * (lamp * shine(n, lampAt, tight) + window * shine(n, windowAt, tight) + house * shine(n, houseAt, tight)) * 0.5;
  o = vec4(colour * uLight.z, 1.0);
}`;

/** A mote of dust in the beam: a point, soft, as bright as the light it drifts through. */
export const MOTE_VS = `#version 300 es
layout(location = 0) in vec4 aSeed;
uniform vec2 uBox;
uniform float uTime;
uniform vec4 uBeam;
uniform vec2 uLens;
uniform vec4 uPic;
uniform float uPixel;
out float vLight;
void main() {
  // Each drifts along a slow path of its own inside the cone: its row across the beam and its distance from the lens.
  float t = uTime;
  float v = 0.08 + 0.84 * fract(aSeed.x + 0.013 * sin(t * (0.21 + aSeed.z * 0.3) + aSeed.w * 6.283) + t * 0.004 * (aSeed.y - 0.5));
  float along = fract(aSeed.y + t * 0.006 * (aSeed.z - 0.4) + 0.02 * sin(t * 0.17 + aSeed.x * 40.0));
  float dist = 130.0 + 360.0 * along;
  vec2 tr = vec2(uPic.x + uPic.z, uPic.y) - uLens;
  vec2 br = vec2(uPic.x + uPic.z, uPic.y + uPic.w) - uLens;
  float aT = atan(tr.y, -tr.x);
  float aB = atan(br.y, -br.x);
  float a = mix(aT, aB, v);
  vec2 s = uLens + dist * vec2(-cos(a), sin(a)) + vec2(0.0, 3.0 * sin(t * 0.4 + aSeed.w * 20.0));
  float off = (v - 0.55) / 0.4;
  float twinkle = 0.5 + 0.5 * sin(t * (1.3 + 2.4 * aSeed.w) + aSeed.x * 60.0);
  vLight = uBeam.x * (0.4 + 0.6 * exp(-off * off)) * (0.15 + 0.85 * twinkle * twinkle) * (0.2 + 0.4 * aSeed.z);
  gl_Position = vec4(s.x / uBox.x * 2.0 - 1.0, 1.0 - s.y / uBox.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.5, (1.8 + 4.0 * aSeed.w * aSeed.w * aSeed.w) * uPixel);
}`;

export const MOTE_FS = `#version 300 es
precision highp float;
in float vLight;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float a = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d));
  o = vec4(vec3(1.0, 0.96, 0.86) * a * vLight, 0.0);
}`;
