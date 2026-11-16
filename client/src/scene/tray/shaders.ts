/**
 * The tray's shaders: the tray itself (one mesh, one draw), and the shadow it
 * lays on the table.
 *
 * The tray is lit as everything else on the table is (the scene's shared
 * uniforms and `finish`): the key by its angle, the room by how much of it a
 * face sees, a little of the table's light back onto its walls, the lamp's
 * pool; and its wood has the table's own satin finish (the key, the window and
 * the lamp in it), the felt none. Its picture already holds the occlusion of
 * its own shape (baked in Blender), so a well is deep before any light is
 * worked out here. What is added here is what moves: the key's shadow inside
 * each well (a box open at the top: shade.ts), and the shadows of the counters
 * lying in the wells (the pieces' own casters, listed well by well).
 *
 * Its shadow on the table is drawn the way the scene fakes every shadow: no
 * shadow map, but the tray's rounded footprint between two heights, tested
 * along the ray toward the key (the table's own arithmetic for a board), and
 * multiplied onto the table as the counters' shadows are.
 */
import { COMMON } from '../shaders';
import { CAST } from '../pieces/shaders';
import { TRAY_OPENINGS, TRAY_SHADE } from './shade';

export const TRAY_VERTEX = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vPos = position;
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const TRAY_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
${COMMON}
${CAST}
${TRAY_SHADE}
uniform sampler2D uTrayTex;     // base colour with the occlusion of its own shape, sRGB
uniform vec4 uTrayCasters[${TRAY_OPENINGS}];  // for each opening, the counters lying in it (rows of the caster table; -1 none)
uniform vec4 uTrayFelt;         // the felt pad: its rectangle in the tray's own frame
uniform vec4 uTrayLook;         // the wood's gloss; the table's light back onto a wall; the height of the felt in the board frame; how far the finish follows the grain
uniform vec4 uTrayFeltLook;     // the felt's nap: how much lighter it is seen along the cloth than straight down; unused; unused; unused
uniform vec4 uPool;             // the lamp's pool on the table: its centre; where it starts to fall, and where it ends
uniform vec4 uTableSheen;       // the table's finish: key highlight, window highlight, reflectance facing the eye, lobe sharpness
uniform vec3 uWinDir;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vPos);
  vec3 albedo = texture2D(uTrayTex, vUv).rgb;
  vec2 l = trayLocal(vPos.xy);
  bool felt = N.z > 0.9 && abs(vPos.z - uTrayLook.z) < 0.004 && l.x > uTrayFelt.x && l.x < uTrayFelt.z && l.y > uTrayFelt.y && l.y < uTrayFelt.w;

  // ---- what stands in the light's way: the walls of the well it is in, the counters lying there ----
  float under;
  float keyVis = trayKey(vPos + N * 0.012, under);
  float lit = 1.0;
  float occ = 0.0;
  float contact = 0.0;
  if (uLight.y > 0.5) {
    float pix = 0.75 * length(fwidth(vPos.xy)) + 0.0005;
    for (int i = 0; i < ${TRAY_OPENINGS}; i++) {
      vec4 r = uTrayWells[i];
      if (l.x > r.x - 0.07 && l.x < r.z + 0.07 && l.y > r.y - 0.07 && l.y < r.w + 0.07) {
        vec4 list = uTrayCasters[i];
        for (int k = 0; k < 4; k++) {
          if (list[k] < 0.0) break;
          castOne(int(list[k] + 0.5), vPos, pix, lit, occ, contact);
        }
        break;
      }
    }
  } else {
    keyVis = 1.0;
  }
  float ao = clamp(1.0 - occ, 0.25, 1.0);
  float pool = (1.0 - uRig.y * smoothstep(uPool.z, uPool.w, length(vPos.xy - uPool.xy))) * lampPool(vPos);
  vec3 light;
  if (uLight.z > 0.5) {
    float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
    // The room's light by the face's direction (rooms.ts; without a room the old sky).
    vec3 sky = roomLight(N);
    // A wall has the table (or the well's floor) under it for half its view, and takes a little of that light.
    float back = uTrayLook.y * (1.0 - N.z) * (0.45 + 0.55 * keyVis * lit) * mix(1.0, 0.5, smoothstep(0.0, uTrayC.z, under));
    light = uLight.x * key * keyVis * lit + (1.0 - uLight.x) * sky * ao + back * ao;
  } else {
    light = vec3((0.74 + 0.26 * N.z) * (0.72 + 0.28 * lit * keyVis));
  }
  light *= 1.0 - 0.3 * contact;
  vec3 col = albedo * light * pool;

  // ---- the wood's satin finish: the key, the window and the lamp in it, as in the table's -----------
  if (uLight.z > 0.5 && !felt) {
    float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
    // The finish is thinnest where the wood is worn pale, and broken where the grain is open and dark.
    float rough = clamp(0.5 + uTrayLook.w * (smoothstep(0.035, 0.11, lum) - 0.6 * smoothstep(0.012, 0.0, lum)), 0.3, 0.85);
    vec3 R = reflect(-V, N);
    float nv = clamp(dot(N, V), 0.0, 1.0);
    float fres = uTableSheen.z + (1.0 - uTableSheen.z) * pow(1.0 - nv, 4.0);
    float k = uTableSheen.w * (1.6 - rough);
    float gloss = uTrayLook.x * (1.25 - rough);
    // Down in a well less of the room is there to be mirrored.
    float open = mix(1.0, 0.3, smoothstep(0.0, uTrayC.z, under)) * ao;
    float key = exp(-k * (1.0 - dot(R, uKeyDir))) * lit * keyVis;
    float win = exp(-0.7 * k * (1.0 - dot(R, uWinDir)));
    col += fres * gloss * (uTableSheen.x * key + uTableSheen.y * win) * pool * open * vec3(1.0, 0.96, 0.9);
    float lampLobe = exp(-uLampB.z * (1.6 - rough) * (1.0 - dot(R, normalize(uLamp.xyz - vPos))));
    col += uLampB.y * gloss * lampLobe * (1.0 + uLampB.w * pow(1.0 - nv, 4.0)) * open * vec3(1.0, 0.96, 0.9);
    // The room (rooms.ts) in the satin finish, by its roughness.
    if (uRoom.x > 0.5) col += roomRadiance(R, rough) * roomBRDF(vec3(uTableSheen.z), rough, nv) * min(uTrayLook.x, 1.0) * open;
  }
  // ---- the felt has no finish, but a nap: seen along the cloth its fibres stand in the light ---------------
  if (uLight.z > 0.5 && felt) {
    float nv = clamp(dot(N, V), 0.0, 1.0);
    col += albedo * uTrayFeltLook.x * pow(1.0 - nv, 3.0) * (0.35 + 0.65 * keyVis * lit) * ao * pool;
  }
  gl_FragColor = finish(col);
}
`;

/** The tray's shadow on the table: a flat piece of the table's plane round the tray, multiplied onto what is there. */
export const TRAY_SHADOW_VERTEX = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const TRAY_SHADOW_FRAGMENT = /* glsl */ `
varying vec3 vPos;
${COMMON}
${TRAY_SHADE}
uniform vec4 uTrayShadow;   // the tray's height above the table; the penumbra's slope; the contact line's width; how dark the shadow may be

void main() {
  if (uLight.y < 0.5 || uTrayB.w < 0.5) discard;
  vec2 p0 = trayLocal(vPos.xy);
  vec2 hs = uTrayB.xy;
  float rad = uTrayC.w;
  float thick = uTrayShadow.x;
  float d0 = roundRect(p0, hs, rad);
  // The ray toward the key climbs the tray's height; seen from above its track is p0 .. p0 + v.
  vec2 lh = uKeyDir.xy / uKeyDir.z;
  vec2 vv = vec2(uTray.z * lh.x + uTray.w * lh.y, uTray.z * lh.y - uTray.w * lh.x) * thick;
  float vl = max(dot(vv, vv), 1e-8);
  float pix = 0.75 * length(fwidth(vPos.xy)) + 0.001;
  float t1 = clamp(-dot(p0, vv) / vl, 0.0, 1.0);
  vec2 cnr = sign(p0 + vv * t1) * (hs - rad);
  float t2 = clamp(dot(cnr - p0, vv) / vl, 0.0, 1.0);
  float sh = 0.0;
  for (int i = 0; i < 6; i++) {
    float t = i < 4 ? float(i) / 3.0 : (i == 4 ? t1 : t2);
    float w = max(t * thick * uTrayShadow.y, pix);
    sh = max(sh, 1.0 - smoothstep(-w, w, roundRect(p0 + vv * t, hs, rad)));
  }
  // What its wall hides of the room, and the dark line where it stands on the table.
  float dd = max(d0, 0.0);
  float occ = 0.5 * (1.0 - dd / sqrt(dd * dd + thick * thick)) * (1.0 - smoothstep(0.25, 0.75, dd));
  float ao = clamp(1.0 - 0.8 * occ, 0.03, 1.0);
  float contact = 0.35 * exp(-dd / uTrayShadow.z);
  float share = uLight.x;
  float light = share * (1.0 - sh) * (1.0 - contact) * (1.0 - 0.3 * (1.0 - ao)) + (1.0 - share) * ao * (1.0 - 0.6 * contact);
  light = mix(1.0, light, uTrayShadow.w);
  if (light > 0.996) discard;
  // The frame holds values already on the screen's curve: a share of the light is that share's root there.
  gl_FragColor = vec4(vec3(pow(clamp(light, 0.0, 1.0), 1.0 / 2.2)), 1.0);
}
`;
