import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../Physics/PhysicsWorld';
import type { AudioManager } from '../Audio/AudioManager';
import { Zombie, ZombieContext } from './Zombie';
import { ZState } from './ZombieAI';
import type { ZombieType, ZombieWaveMods } from './ZombieTypes';

const POOL_SIZE = 28;
const WORLD_LIMIT = 90;

/** Zombie object pool + spawning + crowd separation. Zombies are never created/destroyed during play. */
export class ZombieSpawner {
  readonly pool: Zombie[] = [];
  /** Shared mutable context; GameManager fills in the player-related fields every frame. */
  readonly ctx: ZombieContext;
  private shape: RAPIER.Capsule;

  constructor(private physics: PhysicsWorld, scene: THREE.Scene, audio: AudioManager) {
    for (let i = 0; i < POOL_SIZE; i++) this.pool.push(new Zombie(physics, scene));

    // One shared kinematic character controller for all zombies
    const c = physics.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(0.35, 0.2, false);
    c.enableSnapToGround(0.3);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(50);
    this.shape = new physics.RAPIER.Capsule(0.4, 0.42);

    this.ctx = {
      playerPos: new THREE.Vector3(), playerAlive: true, playerSprinting: false,
      damagePlayer: () => {}, controller: c, audio,
    };
  }

  /** Alive zombies (not dead, not pooled). */
  get aliveCount() {
    let n = 0;
    for (const z of this.pool) if (z.isAlive) n++;
    return n;
  }

  private blocked(x: number, y: number, z: number) {
    return !!this.physics.world.intersectionWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, this.shape);
  }

  private acquire(): Zombie | null {
    for (const z of this.pool) if (!z.active) return z;
    let best: Zombie | null = null; // recycle the oldest corpse
    for (const z of this.pool) if (z.ai.state === ZState.Dead && (!best || z.deathT > best.deathT)) best = z;
    return best;
  }

  /** Spawn on a free spot 22-60 m from the player. Returns false if no spot/slot was available. */
  spawn(type: ZombieType, mods: ZombieWaveMods, playerPos: THREE.Vector3): boolean {
    const z = this.acquire();
    if (!z) return false;
    for (let t = 0; t < 24; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 32;
      const x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, playerPos.x + Math.cos(a) * r));
      const zz = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, playerPos.z + Math.sin(a) * r));
      if (Math.hypot(x - playerPos.x, zz - playerPos.z) < 22) continue;
      if (this.blocked(x, 0.9, zz)) continue;
      if (z.active) z.deactivate();
      z.spawn(type, mods, x, zz);
      return true;
    }
    return false;
  }

  update(dt: number) {
    const p = this.pool;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]; a.sepX = 0; a.sepZ = 0;
    }
    for (let i = 0; i < p.length; i++) {
      const a = p[i]; if (!a.isAlive) continue;
      for (let j = i + 1; j < p.length; j++) {
        const b = p[j]; if (!b.isAlive) continue;
        const dx = a.x - b.x, dz = a.z - b.z, d2 = dx * dx + dz * dz;
        if (d2 < 1.44 && d2 > 1e-4) {
          const d = Math.sqrt(d2), f = (1.2 - d) / 1.2;
          const nx = (dx / d) * f, nz = (dz / d) * f;
          a.sepX += nx; a.sepZ += nz; b.sepX -= nx; b.sepZ -= nz;
        }
      }
    }
    for (const z of p) z.update(dt, this.ctx);
  }

  /** Noise (gunshot): idle zombies within `radius` become aggressive. */
  alertAround(pos: THREE.Vector3, radius: number) {
    const r2 = radius * radius;
    for (const z of this.pool) {
      if (!z.isAlive || z.ai.state !== ZState.Idle) continue;
      const dx = z.x - pos.x, dz = z.z - pos.z;
      if (dx * dx + dz * dz < r2) z.ai.alert();
    }
  }

  reset() { for (const z of this.pool) if (z.active) z.deactivate(); }
}
