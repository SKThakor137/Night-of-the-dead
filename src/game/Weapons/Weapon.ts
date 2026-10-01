import * as THREE from 'three';
import type { WeaponDef, AmmoType } from './WeaponDefs';
import type { PlayerController } from '../Player/PlayerController';
import type { Combat } from '../Systems/Combat';
import type { Effects } from '../Systems/Effects';
import type { AudioManager } from '../Audio/AudioManager';

export interface WeaponContext {
  camera: THREE.PerspectiveCamera;
  player: PlayerController;
  combat: Combat;
  effects: Effects;
  audio: AudioManager;
  /** Make noise at a position (zombies react in Phase 3). */
  alert: (pos: THREE.Vector3, radius: number) => void;
}

export interface WeaponHud { ammo: number; reserve: number; reloading: boolean }

/** Base class every weapon extends. The view model lives in its own scene (always drawn on top). */
export abstract class Weapon {
  readonly view = new THREE.Group();
  protected base = new THREE.Vector3(0.2, -0.2, -0.45);
  private pos = new THREE.Vector3();
  private rot = new THREE.Euler();

  constructor(readonly def: WeaponDef) {}

  abstract update(dt: number, ctx: WeaponContext): void;
  /** `trigger` is already resolved by the manager (held for auto weapons, fresh click otherwise). */
  abstract primary(trigger: boolean, ctx: WeaponContext): void;

  reload(_ctx: WeaponContext) {}
  getHud(): WeaponHud { return { ammo: -1, reserve: -1, reloading: false }; }
  addReserve(_type: AmmoType, _n: number) {}
  reset() {}
  onUnequip() {}
  setPrewarm(_on: boolean) {}

  /** Subclasses add animation offsets here. */
  protected pose(_pos: THREE.Vector3, _rot: THREE.Euler) {}

  applyPose(bobX: number, bobY: number, lower: number) {
    this.pos.set(this.base.x + bobX, this.base.y + bobY - lower * 0.35, this.base.z);
    this.rot.set(lower * 0.9, 0, 0);
    this.pose(this.pos, this.rot);
    this.view.position.copy(this.pos);
    this.view.rotation.copy(this.rot);
  }
}
