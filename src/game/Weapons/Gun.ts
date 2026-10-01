import * as THREE from 'three';
import { Weapon, WeaponContext, WeaponHud } from './Weapon';
import type { WeaponDef, AmmoType } from './WeaponDefs';

/** Generic hitscan firearm (pistol now; shotgun/rifle just need a different WeaponDef). */
export class Gun extends Weapon {
  ammo: number;
  reserve: number;
  private reloading = false;
  private reloadT = 0;
  private cd = 0;
  private kickAnim = 0;
  private flashT = 0;
  private flash!: THREE.Mesh;

  private origin = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private lightPos = new THREE.Vector3();

  constructor(def: WeaponDef) {
    super(def);
    this.ammo = def.magSize;
    this.reserve = def.startReserve;
    this.build();
  }

  private build() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.7, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.9 });
    const add = (g: THREE.BoxGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z); mesh.rotation.x = rx;
      this.view.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.045, 0.08, 0.22), metal, 0, 0, 0);          // frame
    add(new THREE.BoxGeometry(0.05, 0.045, 0.24), metal, 0, 0.055, -0.01);  // slide
    add(new THREE.BoxGeometry(0.02, 0.02, 0.05), dark, 0, 0.055, -0.15);    // barrel tip
    add(new THREE.BoxGeometry(0.04, 0.11, 0.06), dark, 0, -0.085, 0.07, 0.2); // grip
    add(new THREE.BoxGeometry(0.07, 0.07, 0.09), skin, 0, -0.09, 0.08);     // hand
    add(new THREE.BoxGeometry(0.075, 0.075, 0.4), skin, 0.03, -0.12, 0.3);  // forearm

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.flash.position.set(0, 0.055, -0.2);
    this.flash.visible = false;
    this.view.add(this.flash);
  }

  update(dt: number, _ctx: WeaponContext) {
    this.cd -= dt;
    this.kickAnim *= Math.exp(-dt * 16);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload(_ctx);
    }
  }

  primary(trigger: boolean, ctx: WeaponContext) {
    if (!trigger || this.reloading || this.cd > 0) return;
    if (this.ammo <= 0) {
      ctx.audio.empty();
      this.cd = 0.3;
      if (this.reserve > 0) this.reload(ctx);
      return;
    }
    this.fire(ctx);
  }

  private fire(ctx: WeaponContext) {
    const def = this.def;
    this.ammo--;
    this.cd = def.cooldown;
    this.kickAnim = 1;

    ctx.camera.getWorldPosition(this.origin);
    ctx.camera.getWorldDirection(this.fwd);
    ctx.camera.localToWorld(this.muzzle.set(0.18, -0.1, -0.7));
    const spread = def.spread * (1 + Math.min(1, ctx.player.speed / 6) * 2.5);

    for (let i = 0; i < def.pellets; i++) {
      this.dir.copy(this.fwd);
      this.dir.x += (Math.random() - 0.5) * 2 * spread;
      this.dir.y += (Math.random() - 0.5) * 2 * spread;
      this.dir.z += (Math.random() - 0.5) * 2 * spread;
      this.dir.normalize();

      const hit = ctx.combat.shoot(this.origin, this.dir, def.range, def.damage * 0.6);
      if (hit.target) {
        ctx.combat.damage(hit.target, def.damage * (hit.head ? def.headshotMult : 1), hit.head, hit.point, this.dir);
      } else if (hit.hitWorld) {
        ctx.effects.burst(hit.point, this.dir, 7, 'spark');
      }
      ctx.effects.tracer(this.muzzle, hit.point);
    }

    this.lightPos.copy(this.origin).addScaledVector(this.fwd, 0.8);
    ctx.effects.flashMuzzle(this.lightPos);
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashT = 0.045;
    ctx.player.addKick(def.recoilKick);
    ctx.audio.shot();
    ctx.alert(this.origin, def.noiseRadius);
  }

  reload(ctx: WeaponContext) {
    if (this.reloading || this.ammo >= this.def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = this.def.reloadTime;
    ctx.audio.reload(0);
  }

  private finishReload(ctx: WeaponContext) {
    const n = Math.min(this.def.magSize - this.ammo, this.reserve);
    this.ammo += n;
    this.reserve -= n;
    this.reloading = false;
    ctx.audio.reload(1);
  }

  getHud(): WeaponHud { return { ammo: this.ammo, reserve: this.reserve, reloading: this.reloading }; }

  addReserve(type: AmmoType, n: number) {
    if (type === this.def.ammoType) this.reserve = Math.min(this.def.maxReserve, this.reserve + n);
  }

  reset() {
    this.ammo = this.def.magSize;
    this.reserve = this.def.startReserve;
    this.reloading = false; this.cd = 0; this.kickAnim = 0;
    this.flash.visible = false;
  }

  onUnequip() { this.reloading = false; }
  setPrewarm(on: boolean) { this.flash.visible = on; }

  protected pose(pos: THREE.Vector3, rot: THREE.Euler) {
    pos.z += this.kickAnim * 0.06;
    rot.x += this.kickAnim * 0.25;
    if (this.reloading) {
      const p = 1 - Math.max(0, this.reloadT) / this.def.reloadTime;
      const dip = Math.sin(p * Math.PI);
      pos.y -= dip * 0.12;
      rot.x -= dip * 0.6;
      rot.z += dip * 0.4;
    }
  }
}
