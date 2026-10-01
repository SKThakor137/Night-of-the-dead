import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../Physics/PhysicsWorld';
import type { Damageable } from '../Systems/Combat';
import type { AudioManager } from '../Audio/AudioManager';
import { ZombieAI, ZState } from './ZombieAI';
import { buildZombieModel, applyZombieType, ZombieModel } from './ZombieModel';
import { ZOMBIE_TYPES, ZombieStats, ZombieType, ZombieWaveMods } from './ZombieTypes';

export interface ZombieContext {
  playerPos: THREE.Vector3;
  playerAlive: boolean;
  playerSprinting: boolean;
  damagePlayer: (amount: number, from: THREE.Vector3) => void;
  controller: RAPIER.KinematicCharacterController;
  audio: AudioManager;
}

/** Collider membership 0x0004: collides with player/world, ignored by bullet rays. */
export const ZOMBIE_GROUPS = ((0x0004 << 16) | 0xffff) >>> 0;
const HALF = 0.4, RAD = 0.35, CENTER_Y = HALF + RAD; // capsule centre height above feet
const DEAD_TIME = 4;
const RISE_TIME = 0.9;       // zombies claw their way out of the ground when spawned
const HIDE_DIST2 = 95 * 95;  // beyond this the fog hides them completely → don't draw
const ANIM_DIST2 = 60 * 60;  // beyond this skip limb animation (cheap LOD)

function wrapPi(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

export class Zombie implements Damageable {
  readonly group = new THREE.Group();
  readonly object = this.group;
  readonly model: ZombieModel;
  readonly hitMeshes: THREE.Mesh[];
  readonly center = new THREE.Vector3();
  readonly flesh = true;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly ai: ZombieAI;

  active = false;
  type: ZombieType = 'walker';
  stats: ZombieStats = ZOMBIE_TYPES.walker;
  hp = 0; maxHp = 0; speed = 0; damage = 0;

  // position of the capsule centre
  x = 0; y = 0; z = 0;
  // AI → movement interface
  moveX = 0; moveZ = 0; moveSpeed = 0; faceX = 0; faceZ = 1;
  // separation from other zombies (set by spawner)
  sepX = 0; sepZ = 0;
  deathT = 0;
  spawnT = 0;

  private yaw = 0;
  private vy = 0;
  private grounded = false;
  private kbx = 0; private kbz = 0;
  private animT = Math.random() * 10;
  private actualSpeed = 0;
  private stuckT = 0; private unstickT = 0; private ux = 0; private uz = 0;
  // per-zombie variation
  private limp = false;
  private tilt = 0;
  private armBias = 0;
  private deathDir = 1;
  private riseOffset = 0;

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    const { world, RAPIER } = physics;
    this.model = buildZombieModel(this.group);
    this.hitMeshes = this.model.hitMeshes;
    for (const m of this.hitMeshes) m.userData = { target: this, head: m === this.model.headMesh };
    this.group.rotation.order = 'YXZ';
    this.group.visible = false;
    scene.add(this.group);

    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RAD).setCollisionGroups(ZOMBIE_GROUPS), this.body);
    this.body.setEnabled(false);
    this.ai = new ZombieAI(this);
  }

  get isAlive() { return this.active && this.ai.state !== ZState.Dead; }

  spawn(type: ZombieType, mods: ZombieWaveMods, x: number, z: number) {
    this.type = type;
    this.stats = ZOMBIE_TYPES[type];
    this.maxHp = this.hp = this.stats.hp * mods.hp;
    this.speed = this.stats.speed * mods.speed * (0.9 + Math.random() * 0.2);
    this.damage = this.stats.damage * mods.damage;
    this.x = x; this.y = CENTER_Y + 0.1; this.z = z;
    this.vy = 0; this.kbx = this.kbz = 0; this.deathT = 0; this.spawnT = 0;
    this.stuckT = this.unstickT = 0;
    this.moveX = this.moveZ = 0; this.moveSpeed = 0;
    this.limp = Math.random() < 0.3;
    this.tilt = (Math.random() - 0.5) * 0.5;
    this.armBias = (Math.random() - 0.5) * 0.35;
    this.deathDir = Math.random() < 0.5 ? 1 : -1;
    this.yaw = Math.random() * Math.PI * 2;
    this.faceX = Math.sin(this.yaw); this.faceZ = Math.cos(this.yaw);
    applyZombieType(this.model, this.group, type, this.stats);
    this.group.visible = true;
    this.group.rotation.set(0, this.yaw, 0);
    this.body.setEnabled(true);
    this.body.setTranslation({ x, y: this.y, z }, true);
    this.body.setNextKinematicTranslation({ x, y: this.y, z });
    this.ai.reset();
    this.active = true;
    this.riseOffset = 1.7;
    this.syncVisual();
  }

  deactivate() {
    this.active = false;
    this.group.visible = false;
    this.body.setEnabled(false);
  }

  /** Returns true if this hit killed the zombie. */
  takeDamage(amount: number, _head: boolean): boolean {
    if (!this.isAlive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.ai.onDeath();
      this.deathT = 0;
      this.group.visible = true;
      this.body.setEnabled(false); // corpse no longer blocks the player
      return true;
    }
    this.ai.onDamaged();
    return false;
  }

  knock(dx: number, dz: number, force: number) {
    const l = Math.hypot(dx, dz) || 1;
    this.kbx += (dx / l) * force; this.kbz += (dz / l) * force;
  }

  update(dt: number, ctx: ZombieContext) {
    if (!this.active) return;
    if (this.ai.state === ZState.Dead) {
      this.deathT += dt;
      this.animateDead();
      if (this.deathT > DEAD_TIME) this.deactivate();
      return;
    }

    // distance LOD: far zombies are hidden (fog) and not animated
    const pdx = this.x - ctx.playerPos.x, pdz = this.z - ctx.playerPos.z;
    const d2 = pdx * pdx + pdz * pdz;
    this.group.visible = d2 < HIDE_DIST2;

    // rising out of the ground: helpless for a moment
    if (this.spawnT < RISE_TIME) {
      this.spawnT += dt;
      const t = Math.min(1, this.spawnT / RISE_TIME);
      this.riseOffset = (1 - (1 - (1 - t) * (1 - t))) * 1.7; // ease-out
      this.faceX = -pdx; this.faceZ = -pdz;
      this.yaw += wrapPi(Math.atan2(this.faceX, this.faceZ) - this.yaw) * Math.min(1, dt * 4);
      this.model.armL.rotation.x = this.model.armR.rotation.x = -2.6 * (1 - t);
      this.model.torsoPivot.rotation.x = 0.5 * (1 - t);
      this.syncVisual();
      return;
    }
    this.riseOffset = 0;

    this.ai.update(dt, ctx);

    // desired horizontal velocity
    let vx = this.moveX * this.moveSpeed, vz = this.moveZ * this.moveSpeed;
    if (this.moveSpeed > 0) { vx += this.sepX * 1.6; vz += this.sepZ * 1.6; }
    if (this.unstickT > 0) { this.unstickT -= dt; vx = this.ux * this.speed; vz = this.uz * this.speed; }
    vx += this.kbx; vz += this.kbz;
    const k = Math.exp(-dt * 8); this.kbx *= k; this.kbz *= k;

    this.vy = this.grounded ? -2 : Math.max(this.vy - 22 * dt, -30);
    const desired = { x: vx * dt, y: this.vy * dt, z: vz * dt };
    ctx.controller.computeColliderMovement(this.collider, desired);
    const m = ctx.controller.computedMovement();
    this.grounded = ctx.controller.computedGrounded();

    // stuck detection (walking into a wall corner): sidestep for a moment
    const want = Math.hypot(vx, vz);
    this.actualSpeed = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    if (this.moveSpeed > 0.5 && this.unstickT <= 0 && this.actualSpeed < want * 0.25) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.7) {
      this.stuckT = 0; this.unstickT = 0.9;
      const a = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.5);
      this.ux = this.moveX * Math.cos(a) - this.moveZ * Math.sin(a);
      this.uz = this.moveX * Math.sin(a) + this.moveZ * Math.cos(a);
    }

    this.x += m.x; this.y += m.y; this.z += m.z;
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y, z: this.z });

    // smooth turning toward the facing direction
    const target = Math.atan2(this.faceX, this.faceZ);
    this.yaw += wrapPi(target - this.yaw) * Math.min(1, dt * 8);
    this.syncVisual();
    if (d2 < ANIM_DIST2) this.animate(dt);
  }

  private syncVisual() {
    this.group.position.set(this.x, this.y - CENTER_Y - this.riseOffset, this.z);
    this.group.rotation.y = this.yaw;
    this.center.set(this.x, this.y + 0.2, this.z);
  }

  private animate(dt: number) {
    const m = this.model;
    const st = this.ai.state;
    this.animT += dt * (1.5 + this.actualSpeed * 2.4);
    const sw = Math.sin(this.animT);
    const amp = Math.min(1, this.actualSpeed / 2.5);
    m.legL.rotation.x = sw * (this.limp ? 0.35 : 0.75) * amp;       // limping zombies drag a leg
    m.legR.rotation.x = -sw * 0.75 * amp;
    m.torsoPivot.rotation.z = sw * 0.07 * amp * (this.limp ? 2 : 1); // lurching sway
    m.headPivot.rotation.z = this.tilt;

    let armL = -sw * 0.4 * amp, armR = sw * 0.4 * amp, lean = 0.08, headX = 0;
    switch (st) {
      case ZState.Detect:
        armL = armR = -0.35; lean = -0.2; headX = -0.6; break;
      case ZState.Chase:
        armL = -1.35 + this.armBias + Math.sin(this.animT * 0.5) * 0.12;
        armR = -1.35 - this.armBias - Math.sin(this.animT * 0.5) * 0.12;
        lean = 0.22; break;
      case ZState.Attack: {
        const w = this.stats.attackWindup, t = this.ai.attackT;
        const a = t < w ? -1.4 - 0.55 * (t / w) : -1.95 + Math.min(1, (t - w) / 0.25) * 1.5;
        armL = armR = a; lean = t < w ? 0.15 : 0.4; break;
      }
      case ZState.Hurt:
        armL = armR = -0.8; lean = -0.45; headX = 0.3; break;
    }
    m.armL.rotation.x = armL; m.armR.rotation.x = armR;
    m.torsoPivot.rotation.x += (lean - m.torsoPivot.rotation.x) * Math.min(1, dt * 12);
    m.headPivot.rotation.x += (headX - m.headPivot.rotation.x) * Math.min(1, dt * 10);
  }

  private animateDead() {
    const t = Math.min(1, this.deathT / 0.5);
    this.group.rotation.x = -t * (Math.PI / 2) * this.deathDir; // falls backward or forward
    const sink = Math.max(0, this.deathT - (DEAD_TIME - 1));
    this.group.position.y = this.y - CENTER_Y + t * 0.14 - sink * 0.6;
    this.model.armL.rotation.x = this.model.armR.rotation.x = -0.4 * t;
  }
}
