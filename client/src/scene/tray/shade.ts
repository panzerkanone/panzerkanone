/**
 * The light inside the tray's wells, for whatever is drawn there: the tray's
 * own floors and walls, and the counters lying in it. No shadow map (ruling
 * 4): a well is a box open at the top, so a point in it sees the key light
 * exactly when the ray toward the key leaves through the opening. Goes after
 * the scene's COMMON (it reads `uKeyDir`). A string only: this file imports
 * nothing, so that the pieces' shaders and the tray's can both take it.
 */

/** How many openings the shaders are told of: the eight wells and the felt well. */
export const TRAY_OPENINGS = 9;

export const TRAY_SHADE = /* glsl */ `
uniform vec4 uTray;          // the tray: its middle on the plan (x, y); the cosine and sine of its turn
uniform vec4 uTrayB;         // half its length, half its depth; the height of its rim in the board frame; 1 when there is a tray, 0 when none
uniform vec4 uTrayC;         // the penumbra's slope inside a well; how much of the room the bottom of a well loses; a well's depth; the tray's corner radius
uniform vec4 uTrayWells[${TRAY_OPENINGS}];  // its openings, each x0, y0, x1, y1 in the tray's own frame

/** A point of the plan in the tray's own frame. */
vec2 trayLocal(vec2 p) {
  vec2 d = p - uTray.xy;
  return vec2(uTray.z * d.x + uTray.w * d.y, uTray.z * d.y - uTray.w * d.x);
}

/**
 * How much of the key reaches a point inside one of the tray's wells (1 anywhere else), and through
 * "under" how far the point is under the rim there (0 anywhere else).
 */
float trayKey(vec3 P, out float under) {
  under = 0.0;
  if (uTrayB.w < 0.5) return 1.0;
  float up = uTrayB.z - P.z;
  if (up <= 0.0) return 1.0;
  vec2 l = trayLocal(P.xy);
  if (abs(l.x) > uTrayB.x || abs(l.y) > uTrayB.y) return 1.0;
  // The way to the key in the tray's frame, for the height still to climb to the rim.
  vec2 lh = uKeyDir.xy / uKeyDir.z;
  vec2 e = l + vec2(uTray.z * lh.x + uTray.w * lh.y, uTray.z * lh.y - uTray.w * lh.x) * up;
  float w = max(up * uTrayC.x, 0.004);
  for (int i = 0; i < ${TRAY_OPENINGS}; i++) {
    vec4 r = uTrayWells[i];
    if (l.x > r.x - 0.004 && l.x < r.z + 0.004 && l.y > r.y - 0.004 && l.y < r.w + 0.004) {
      under = up;
      return smoothstep(-w, w, min(min(e.x - r.x, r.z - e.x), min(e.y - r.y, r.w - e.y)));
    }
  }
  return 1.0;
}
`;
