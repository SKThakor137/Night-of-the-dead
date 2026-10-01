import * as THREE from 'three';
import { Weapon, WeaponContext } from './Weapon';
import type { WeaponDef } from './WeaponDefs';

const SWING_TIME = 0.32;

/** Melee weapon: cone-based hit detection a moment after the swing starts. */
export class Knife extends Weapon {
  private cd = 0;
  private swingT = -1; // < 0 = idle
  private hitDone = false;
  private side = 1;
  private origin = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor(def: WeaponDef) {
    super(def);
    this.base.set(0.24, -0.22, -0.5);
    this.build();
  }

  private build() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.25 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.9 });
    const model = new THREE.Group();
    model.rotation.x = 0.35; // tip pointing slightly up
    const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = model) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z); parent.add(mesh);
    };
    add(0.03, 0.035, 0.13, wood, 0, 0, 0.02);       // handle
    add(0.07, 0.016, 0.022, steel, 0, 0, -0.055);   // guard
    add(0.012, 0.042, 0.24, steel, 0, 0, -0.19);    // blade
    add(0.012, 0.014, 0.05, steel, 0, 0.012, -0.33); // tip
    add(0.07, 0.07, 0.09, skin, 0, -0.02, 0.05);    // hand
    add(0.075, 0.075, 0.4, skin, 0.03, -0.06, 0.28); // forearm
    this.view.add(model);
  }

  update(dt: number, ctx: WeaponContext) {
    this.cd -= dt;
    if (this.swingT < 0) return;
    this.swingT += dt;
    if (!this.hitDone && this.swingT >= this.def.hitDelay) {
      this.hitDone = true;
      this.strike(ctx);
    }
    if (this.swingT >= SWING_TIME) this.swingT = -1;
  }

  primary(trigger: boolean, ctx: WeaponContext) {
    if (!trigger || this.cd > 0) return;
    this.cd = this.def.cooldown;
    this.swingT = 0;
    this.hitDone = false;
    this.side = -this.side;
    ctx.audio.knifeSwing();
    ctx.player.addKick(0.01);
  }

  private strike(ctx: WeaponContext) {
    ctx.camera.getWorldPosition(this.origin);
    ctx.camera.getWorldDirection(this.fwd);
    const target = ctx.combat.meleeTarget(this.origin, this.fwd, this.def.range, this.def.meleeArc);
    if (target) {
      ctx.combat.damage(target, this.def.damage, false, target.center, this.fwd);
      ctx.audio.knifeHit();
      ctx.player.addShake(0.02);
      ctx.alert(this.origin, this.def.noiseRadius);
      return;
    }
    // swung at a wall/prop?
    const hit = ctx.combat.shoot(this.origin, this.fwd, this.def.range, 6);
    if (hit.hitWorld) {
      ctx.effects.burst(hit.point, this.fwd, 5, 'spark');
      ctx.audio.impact();
    }
  }

  reset() { this.cd = 0; this.swingT = -1; }
  onUnequip() { this.swingT = -1; }

  protected pose(pos: THREE.Vector3, rot: THREE.Euler) {
    if (this.swingT < 0) return;
    const p = Math.min(1, this.swingT / SWING_TIME);
    const a = Math.sin(p * Math.PI);
    pos.x -= this.side * a * 0.28;
    pos.y += a * 0.04;
    pos.z -= a * 0.18;
    rot.z += this.side * -a * 1.1;
    rot.y += this.side * a * 0.6;
    rot.x -= a * 0.4;
  }
}
