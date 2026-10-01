import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../Physics/PhysicsWorld';
import type { Input } from '../Systems/Input';

const WALK_SPEED = 4.5;
const SPRINT_SPEED = 8;
const JUMP_SPEED = 7.5;
const GRAVITY = -22;
const EYE_OFFSET = 0.7; // eye height above capsule centre
const MOUSE_SENS = 0.0022;

/** Collision group: membership 0x0002 (player), collides with everything. */
export const PLAYER_GROUPS = ((0x0002 << 16) | 0xffff) >>> 0;

export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  enabled = false; // true only while pointer is locked (mouse look)
  yaw = 0;
  pitch = 0;
  grounded = false;
  sprinting = false;
  speed = 0; // horizontal speed (m/s)
  readonly pos = new THREE.Vector3(); // capsule centre

  private vy = 0;
  private hvx = 0;
  private hvz = 0;
  private kick = 0;
  private shake = 0;
  private roll = 0;
  private eyeDrop = 0;
  private bobT = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private physics: PhysicsWorld,
    spawn: THREE.Vector3,
    private input: Input
  ) {
    const { world, RAPIER } = physics;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z)
    );
    // Capsule: 1.7m tall (0.5 half-height cylinder + 0.35 radius caps)
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.35).setCollisionGroups(PLAYER_GROUPS),
      this.body
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(60);

    camera.rotation.order = 'YXZ';
    document.addEventListener('mousemove', this.onMouseMove);
    this.pos.copy(spawn);
    this.syncCamera(spawn);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    this.yaw -= e.movementX * MOUSE_SENS;
    this.pitch -= e.movementY * MOUSE_SENS;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  };

  setEnabled(v: boolean) { this.enabled = v; }

  /** Camera recoil kick (radians, upward). */
  addKick(r: number) { this.kick = Math.min(0.25, this.kick + r); }
  addShake(s: number) { this.shake = Math.min(0.15, this.shake + s); }

  respawn(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    this.hvx = this.hvz = this.vy = 0;
    this.yaw = this.pitch = this.kick = this.shake = this.roll = this.eyeDrop = 0;
    this.speed = 0;
    this.pos.copy(p);
    this.syncCamera(p);
  }

  update(dt: number) {
    const inp = this.input;
    const active = this.enabled;
    const f = active ? (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0) : 0;
    const r = active ? (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0) : 0;
    this.sprinting = active && f > 0 && (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'));
    const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    // Wish direction from yaw (forward = -Z when yaw = 0)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = -sin * f + cos * r;
    let dz = -cos * f - sin * r;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }

    // Smooth horizontal velocity (less control in the air)
    const accel = Math.min(1, dt * (this.grounded ? 12 : 3));
    this.hvx += (dx * speed - this.hvx) * accel;
    this.hvz += (dz * speed - this.hvz) * accel;

    // Vertical
    if (this.grounded && this.vy < 0) this.vy = -1;
    if (active && this.grounded && inp.isDown('Space')) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    this.vy += GRAVITY * dt;

    const desired = { x: this.hvx * dt, y: this.vy * dt, z: this.hvz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.vy > 0 && m.y < desired.y - 1e-4) this.vy = 0; // bumped head

    const p = this.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y, next.z);

    this.speed = Math.hypot(this.hvx, this.hvz);
    if (this.grounded) this.bobT += dt * this.speed * 1.5;
    this.kick *= Math.exp(-dt * 9);
    this.shake *= Math.exp(-dt * 7);
    this.syncCamera(next);
  }

  /** After death: camera sinks and rolls over. */
  updateDeadCam(dt: number) {
    const k = Math.min(1, dt * 2.5);
    this.roll += (0.9 - this.roll) * k;
    this.eyeDrop += (0.45 - this.eyeDrop) * k;
    this.syncCamera(this.pos);
  }

  private syncCamera(p: { x: number; y: number; z: number }) {
    const bob = Math.sin(this.bobT) * 0.035 * Math.min(1, this.speed / 5);
    const s = this.shake;
    this.camera.position.set(
      p.x + (Math.random() - 0.5) * s,
      p.y + EYE_OFFSET - this.eyeDrop + bob + (Math.random() - 0.5) * s,
      p.z + (Math.random() - 0.5) * s
    );
    this.camera.rotation.set(this.pitch + this.kick, this.yaw, this.roll);
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
