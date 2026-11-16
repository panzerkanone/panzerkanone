/**
 * The projector lamp's flutter (client/src/campaign/roomfx.ts lights the room's beam by it): plain arithmetic, no
 * browser. The owner asked for a fast, smooth wave, "more of a sin wave freq at 20 cycles per second or 15 cycles per
 * second": a sum of sines about nothing, never random steps. Its fastest and strongest is the clatter's own rate (the
 * projector's sound, client/src/audio/projector.ts), so that sight and sound agree; a second near it makes the pair
 * beat slowly, as a worn shutter does; two slow ones are the lamp's own wander.
 */
export function flutter(t: number, hz: number): number {
  const w = 2 * Math.PI * t;
  return 0.15 * Math.sin(w * hz) + 0.07 * Math.sin(w * hz * 0.8637 + 1.3) + 0.045 * Math.sin(w * 6.1 + 0.4) + 0.035 * Math.sin(w * 1.37 + 2.1);
}
