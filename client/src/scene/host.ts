/**
 * The scene's root in react-three-fiber (PLAN V10).
 *
 * The board is three.js objects built by world.ts and handed to the fiber root
 * as one primitive, so that the pieces of Milestone 4b can be mounted beside it
 * as components. The root's frame loop is off: the table page draws a frame
 * itself, and only when something changed (ruling 12). The renderer and the
 * camera are the page's own; fiber is told the size and pixel ratio the page
 * has chosen, and applies the same.
 */
import { createElement } from 'react';
import { createRoot } from '@react-three/fiber';
import type * as THREE from 'three';

export interface SceneHost {
  /** The root's scene: what the page draws. */
  scene: THREE.Scene;
  /** Tell the root the window's size in CSS pixels and the pixel ratio; it sizes the renderer. */
  resize(width: number, height: number, pixelRatio: number): void;
  unmount(): void;
}

export function mountScene(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, world: THREE.Object3D, width: number, height: number, pixelRatio: number): SceneHost {
  const root = createRoot(canvas);
  void root.configure({
    gl: renderer,
    camera: Object.assign(camera, { manual: true }),
    size: { width, height, top: 0, left: 0 },
    dpr: pixelRatio,
    frameloop: 'never',
    flat: true,
    shadows: false,
  });
  const store = root.render(createElement('primitive', { object: world }));
  return {
    scene: store.getState().scene,
    resize(w, h, ratio) {
      const state = store.getState();
      state.setDpr(ratio);
      state.setSize(w, h);
    },
    unmount() {
      root.unmount();
    },
  };
}
