/**
 * A die's shader: a well-rounded cube of polished bakelite with drilled,
 * inked pips, lit as everything on the table is (the scene's shared uniforms
 * and `finish`).
 *
 * Its shape is the surface |x|^ + |y|^ + |z|^ = 1 of view.ts (`dieGeometry`):
 * a face is exactly flat in its middle and curls over the edge with a
 * curvature that starts at nothing, so no arc is butted against a flat and the
 * highlight runs round an edge without a step (the 4b bar's die turntable).
 * The normal is worked out here from the same formula, so the highlight does
 * not depend on how finely the mesh is cut. The pips are found here too, from
 * where on its face a point is: a spherical cap cut into the face, filled with
 * ink, its rim shading the cap's floor from the key. Nothing is a picture.
 *
 * Its light: the key by its angle, shaded by the tray's walls round it
 * (TRAY_SHADE) and by the other dice (the pieces' casters, CAST); the room,
 * less near the felt it lies on; the felt's light back onto its sides; and the
 * finish of polished bakelite: a sharp highlight of the key, the window and
 * the lamp in it, stronger toward a grazing angle. The pips are matte.
 */
import { COMMON } from '../shaders';
import { CAST } from '../pieces/shaders';
import { TRAY_SHADE } from '../tray/shade';

export const DIE_VERTEX = /* glsl */ `
attribute vec4 aPlace;   // its middle, and half its side as drawn (0 while it is gone)
attribute vec4 aTurn;    // its turn, a unit quaternion
attribute vec4 aLook;    // its stock (0 the first, 1 the second); two rows of the caster table that may shadow it (-1 none); a number of its own
varying vec3 vPos;
varying vec3 vObj;
flat varying vec4 vTurn;
flat varying vec4 vLook;
flat varying float vHalf;

vec3 turned3(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 p = turned3(aTurn, position * aPlace.w) + aPlace.xyz;
  vPos = p;
  vObj = position;
  vTurn = aTurn;
  vLook = aLook;
  vHalf = aPlace.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const DIE_FRAGMENT = /* glsl */ `
varying vec3 vPos;
varying vec3 vObj;
flat varying vec4 vTurn;
flat varying vec4 vLook;
flat varying float vHalf;
${COMMON}
${CAST}
${TRAY_SHADE}
uniform vec4 uDie;          // where a face stops being flat, the surface's power, the pips' pitch and radius (shares of half a side)
uniform vec3 uDieBody[2];   // each stock's bakelite, linear
uniform vec3 uDiePip[2];    // and its pips' ink
uniform vec4 uDieFinish;    // reflectance facing the eye; sharpness of the key's highlight; of the window's; the lamp's strength in it
uniform vec4 uDieRoom;      // the felt's height (board frame); how much of the room the foot of a side loses; the felt's light back onto a side; the mottle's strength
uniform vec3 uWinDir;

vec3 turnedBy(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

/** The pips of a face as bits of its three-by-three grid, row by row from a corner. */
int pipMask(int v) {
  return v == 1 ? 16 : v == 2 ? 257 : v == 3 ? 273 : v == 4 ? 325 : v == 5 ? 341 : 365;
}

void main() {
  // ---- which face, and where on it ----------------------------------------------------------------
  vec3 op = vObj;
  vec3 ap = abs(op);
  vec3 axis;
  vec3 t1;
  vec3 t2;
  int face;
  // The faces of view.ts / throw.ts FACE_AXES: 1 +z, 6 -z, 2 +y, 5 -y, 3 +x, 4 -x.
  if (ap.z >= ap.x && ap.z >= ap.y) {
    axis = vec3(0.0, 0.0, sign(op.z));
    t1 = vec3(1.0, 0.0, 0.0);
    t2 = vec3(0.0, 1.0, 0.0);
    face = op.z > 0.0 ? 1 : 6;
  } else if (ap.y >= ap.x) {
    axis = vec3(0.0, sign(op.y), 0.0);
    t1 = vec3(0.0, 0.0, 1.0);
    t2 = vec3(1.0, 0.0, 0.0);
    face = op.y > 0.0 ? 2 : 5;
  } else {
    axis = vec3(sign(op.x), 0.0, 0.0);
    t1 = vec3(0.0, 1.0, 0.0);
    t2 = vec3(0.0, 0.0, 1.0);
    face = op.x > 0.0 ? 3 : 4;
  }
  // The surface's own normal: flat in the middle of a face, curling over the edge.
  vec3 u = max(ap - uDie.x, 0.0) / (1.0 - uDie.x);
  vec3 nObj = normalize(sign(op) * pow(u, vec3(uDie.y - 1.0)) + axis * 1e-4);

  // ---- the pips: a cap cut into the face, filled with ink -------------------------------------------
  vec2 fuv = vec2(dot(op, t1), dot(op, t2));
  float pitch = uDie.z;
  float rp = uDie.w;
  vec2 cell = clamp(floor(fuv / pitch + 0.5), -1.0, 1.0);
  int bit = int(cell.x + 1.0) + int(cell.y + 1.0) * 3;
  bool has = ((pipMask(face) >> bit) & 1) == 1;
  vec2 dv = fuv - cell * pitch;
  float rr = length(dv);
  float aa = fwidth(rr) * 0.75 + 1e-4;
  float pip = has ? 1.0 - smoothstep(rp - aa, rp + aa, rr) : 0.0;
  vec4 iq = vec4(-vTurn.xyz, vTurn.w);
  vec3 keyObj = turnedBy(iq, uKeyDir);
  float pipLit = 1.0;
  float pipFloor = 0.0;
  if (pip > 0.0) {
    float rho = rp * 1.55;
    float rc = min(rr, rp);
    float zc = sqrt(rho * rho - rc * rc);
    float depth = zc - sqrt(rho * rho - rp * rp);
    pipFloor = depth / (rho - sqrt(rho * rho - rp * rp));
    vec2 dn = rr > 1e-5 ? dv / rr : vec2(0.0);
    vec3 nd = normalize(-(t1 * dn.x + t2 * dn.y) * rc + axis * zc);
    nObj = normalize(mix(nObj, nd, pip));
    // The ray toward the key leaves through the cap's opening, or its rim shades this point.
    vec3 lf = vec3(dot(keyObj, t1), dot(keyObj, t2), dot(keyObj, axis));
    if (lf.z > 0.02) {
      vec2 hit = dv + lf.xy * (depth / lf.z);
      pipLit = 1.0 - smoothstep(rp * 0.78, rp * 1.12, length(hit));
    } else {
      pipLit = 0.0;
    }
  }
  vec3 N = normalize(turnedBy(vTurn, nObj));
  vec3 V = normalize(cameraPosition - vPos);

  // ---- its colour: bakelite with a little of the cast's cloud in it, and the pips' ink ----------------
  int stock = vLook.x > 0.5 ? 1 : 0;
  vec4 cloud = texture2D(uNoise, vObj.xy * 0.37 + vObj.z * 0.21 + vLook.w * vec2(0.31, 0.77));
  vec4 fine = texture2D(uNoise, (vObj.yz + vObj.x) * 1.3 + vLook.w * vec2(0.53, 0.19));
  vec3 body = uDieBody[stock] * (1.0 + uDieRoom.w * (cloud.r - 0.5) + 0.35 * uDieRoom.w * (fine.g - 0.5));
  vec3 albedo = mix(body, uDiePip[stock], pip);

  // ---- the light ---------------------------------------------------------------------------------
  float lit = 1.0;
  float occ = 0.0;
  float contact = 0.0;
  float under = 0.0;
  float pixH = max(length(fwidth(vPos)), 1e-5);
  if (uLight.y > 0.5) {
    if (vLook.y >= 0.0) castOne(int(vLook.y + 0.5), vPos, 0.75 * pixH + 0.0005, lit, occ, contact);
    if (vLook.z >= 0.0) castOne(int(vLook.z + 0.5), vPos, 0.75 * pixH + 0.0005, lit, occ, contact);
    lit = min(lit, trayKey(vPos + N * 0.01, under));
    occ += uTrayC.y * smoothstep(0.0, uTrayC.z, under);
  }
  float ao = clamp(1.0 - occ, 0.25, 1.0);
  // The foot of a side is close to the felt: it sees less of the room there.
  float h = max(vPos.z - uDieRoom.x, 0.0);
  float foot = 1.0 - uDieRoom.y * (1.0 - smoothstep(0.0, vHalf * 1.1, h)) * (1.0 - max(N.z, 0.0));
  float light;
  if (uLight.z > 0.5) {
    float key = max(dot(N, uKeyDir), 0.0) / uKeyDir.z;
    float sky = 0.5 + 0.5 * N.z;
    float back = uDieRoom.z * max(-N.z * 0.6 + 0.4, 0.0) * (1.0 - abs(N.z)) * (0.45 + 0.55 * lit);
    light = uLight.x * key * lit * mix(1.0, pipLit, pip) + (1.0 - uLight.x) * sky * ao * foot * mix(1.0, 0.7, pip * pipFloor) + back * ao;
  } else {
    light = (0.74 + 0.26 * N.z) * (0.72 + 0.28 * lit);
  }
  vec3 col = albedo * light;

  // ---- polished bakelite: the key, the window and the lamp in it; the pips' ink is matte ---------------
  if (uLight.z > 0.5) {
    vec3 R = reflect(-V, N);
    float nv = clamp(dot(N, V), 0.0, 1.0);
    float fres = uDieFinish.x + (1.0 - uDieFinish.x) * pow(1.0 - nv, 5.0);
    float shine = (1.0 - 0.85 * pip) * (0.55 + 0.45 * ao);
    float key = exp(-uDieFinish.y * (1.0 - dot(R, uKeyDir))) * lit;
    float win = exp(-uDieFinish.z * (1.0 - dot(R, uWinDir)));
    float lamp = exp(-uDieFinish.y * 0.6 * (1.0 - dot(R, normalize(uLamp.xyz - vPos)))) * uDieFinish.w;
    // The key's highlight is narrow and bright (its share of the light is in it); the window broad and soft.
    col += fres * shine * (9.0 * key + 1.6 * win * (0.4 + 0.6 * ao) + lamp) * vec3(1.0, 0.97, 0.92);
  }
  gl_FragColor = finish(col);
}
`;
