import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../Physics/PhysicsWorld';
import type { Effects } from './Effects';
import type { AudioManager } from '../Audio/AudioManager';

/** Anything bullets can hurt (training dummies now, zombies in Phase 3). */
export interface Damageable {
  readonly isAlive: boolean;
  readonly flesh: boolean;               // true = blood, false = sparks
  readonly object: THREE.Object3D;       // root (matrices refreshed before raycast)
  readonly hitMeshes: THREE.Mesh[];      // meshes with userData { target, head }
  readonly center: THREE.Vector3;        // rough world centre (cheap pre-filter)
  takeDamage(amount: number, head: boolean): boolean; // returns true if this killed it
  knock?(dx: number, dz: number, force: number): void; // small push away from the shot
}

export interface ShotResult {
  target: Damageable | null;
  head: boolean;
  point: THREE.Vector3;
  distance: number;
  hitWorld: boolean;
}

/** Ray membership 0x0008, filter 0x0001: hits environment + props, ignores player/targets colliders. */
const RAY_GROUPS = ((0x0008 << 16) | 0x0001) >>> 0;

/**
 * Hitscan combat. Rapier raycast finds the nearest wall/prop distance, then a
 * Three.js Raycaster tests only nearby damageable meshes within that distance.
 */
export class Combat {
  onDamage?: (t: Damageable, dmg: number, head: boolean, killed: boolean) => void;

  private raycaster = new THREE.Raycaster();
  private ray: RAPIER.Ray;
  private meshes: THREE.Object3D[] = [];
  private v = new THREE.Vector3();
  private result: ShotResult = { target: null, head: false, point: new THREE.Vector3(), distance: 0, hitWorld: false };

  constructor(
    private physics: PhysicsWorld,
    private playerBody: RAPIER.RigidBody,
    private targets: Damageable[],
    private effects: Effects,
    private audio: AudioManager
  ) {
    this.ray = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  /** NOTE: returned object is reused; read it immediately. `push` = impulse applied to dynamic props. */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, push = 2): ShotResult {
    const r = this.result;
    r.target = null; r.head = false; r.hitWorld = false;

    // 1) world distance (Rapier)
    this.ray.origin.x = origin.x; this.ray.origin.y = origin.y; this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x; this.ray.dir.y = dir.y; this.ray.dir.z = dir.z;
    const wall = this.physics.world.castRay(this.ray, range, true, undefined, RAY_GROUPS, undefined, this.playerBody);
    let maxDist = range;
    if (wall) { maxDist = wall.timeOfImpact; r.hitWorld = true; }

    // 2) damageable targets (Three.js Raycaster), pre-filtered by distance to the ray
    this.meshes.length = 0;
    for (const t of this.targets) {
      if (!t.isAlive) continue;
      this.v.copy(t.center).sub(origin);
      const along = this.v.dot(dir);
      if (along < -1 || along > maxDist + 1) continue;
      if (this.v.lengthSq() - along * along > 2.2) continue; // > ~1.5 m from the ray
      t.object.updateMatrixWorld(true);
      for (const m of t.hitMeshes) this.meshes.push(m);
    }
    let hit: THREE.Intersection | undefined;
    if (this.meshes.length) {
      this.raycaster.set(origin, dir);
      this.raycaster.near = 0;
      this.raycaster.far = maxDist;
      hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    }

    if (hit) {
      const ud = hit.object.userData as { target: Damageable; head: boolean };
      r.target = ud.target; r.head = ud.head; r.hitWorld = false;
      r.distance = hit.distance; r.point.copy(hit.point);
    } else {
      r.distance = maxDist;
      r.point.copy(origin).addScaledVector(dir, maxDist);
      if (wall) { // push dynamic props (barrels/crates) — used from Phase 6
        const body = wall.collider.parent();
        if (body && body.isDynamic()) {
          body.applyImpulseAtPoint({ x: dir.x * push, y: dir.y * push, z: dir.z * push }, { x: r.point.x, y: r.point.y, z: r.point.z }, true);
        }
      }
    }
    return r;
  }

  /** Closest living target inside a cone in front of the camera, not hidden behind a wall. */
  meleeTarget(origin: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): Damageable | null {
    let best: Damageable | null = null;
    let bestD = Infinity;
    for (const t of this.targets) {
      if (!t.isAlive) continue;
      this.v.copy(t.center).sub(origin);
      const d = this.v.length();
      if (d > range + 0.5 || d < 1e-4) continue;
      if (this.v.dot(dir) / d < cosHalf) continue;
      if (d >= bestD) continue;
      this.v.divideScalar(d);
      this.ray.origin.x = origin.x; this.ray.origin.y = origin.y; this.ray.origin.z = origin.z;
      this.ray.dir.x = this.v.x; this.ray.dir.y = this.v.y; this.ray.dir.z = this.v.z;
      const wall = this.physics.world.castRay(this.ray, d, true, undefined, RAY_GROUPS, undefined, this.playerBody);
      if (wall && wall.timeOfImpact < d - 0.6) continue;
      best = t; bestD = d;
    }
    return best;
  }

  damage(t: Damageable, amount: number, head: boolean, point: THREE.Vector3, dir: THREE.Vector3) {
    const killed = t.takeDamage(amount, head);
    t.knock?.(dir.x, dir.z, killed ? 0 : 2.2);
    this.effects.burst(point, dir, killed ? 16 : 7, t.flesh ? 'blood' : 'spark');
    if (t.flesh) { if (killed) this.audio.zombieDie(t.center); else this.audio.zombieHurt(t.center); }
    else this.audio.impact();
    this.onDamage?.(t, amount, head, killed);
  }
}
