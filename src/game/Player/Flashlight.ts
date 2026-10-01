import * as THREE from 'three';

const BASE_INTENSITY = 90;

/**
 * Spot light parented to the camera. Toggled via intensity (not visibility) so the
 * light count never changes and shaders are never recompiled.
 */
export class Flashlight {
  readonly light = new THREE.SpotLight(0xfff0cc, BASE_INTENSITY, 48, 0.42, 0.6, 2);
  private target = new THREE.Object3D();
  on = true;
  private flicker = 0;

  constructor(camera: THREE.Camera) {
    this.light.position.set(0.22, -0.18, -0.1);
    this.target.position.set(0, 0, -10);
    camera.add(this.light);
    camera.add(this.target);
    this.light.target = this.target;
  }

  toggle() { this.set(!this.on); }

  set(on: boolean) {
    this.on = on;
    this.light.intensity = on ? BASE_INTENSITY : 0;
  }

  update(dt: number) {
    if (!this.on) return;
    if (this.flicker <= 0 && Math.random() < 0.0015) this.flicker = 0.12;
    if (this.flicker > 0) {
      this.flicker -= dt;
      this.light.intensity = BASE_INTENSITY * (0.25 + Math.random() * 0.5);
    } else {
      this.light.intensity = BASE_INTENSITY;
    }
  }
}
