import * as THREE from 'three';
import type { Weapon, WeaponContext } from './Weapon';
import type { AmmoType } from './WeaponDefs';
import type { Input } from '../Systems/Input';
import type { PlayerController } from '../Player/PlayerController';

/** Owns all weapons, handles switching (1-9 / mouse wheel), reload key, trigger and view-model bob. */
export class WeaponManager {
  readonly weapons: Weapon[] = [];
  readonly slotNames: string[] = [];
  index = 0;

  private target = 0;
  private state: 'idle' | 'lowering' | 'raising' = 'idle';
  private lower = 0;
  private bobT = 0;

  constructor(private root: THREE.Group) {}

  register(w: Weapon) {
    this.weapons.push(w);
    this.slotNames.push(w.def.name);
    this.root.add(w.view);
    w.view.visible = this.weapons.length === 1;
    return this;
  }

  get current(): Weapon { return this.weapons[this.index]; }

  select(i: number) {
    if (this.state !== 'idle' || i === this.index || i < 0 || i >= this.weapons.length) return;
    this.target = i;
    this.state = 'lowering';
  }

  addAmmo(type: AmmoType, n: number) {
    for (const w of this.weapons) w.addReserve(type, n);
  }

  update(dt: number, ctx: WeaponContext, input: Input, player: PlayerController) {
    const n = this.weapons.length;
    for (let i = 0; i < n; i++) if (input.consumePress('Digit' + (i + 1))) this.select(i);
    const wheel = input.consumeWheel();
    if (wheel !== 0 && n > 1) this.select((this.index + (wheel > 0 ? 1 : -1) + n) % n);

    if (this.state === 'lowering') {
      this.lower += dt * 6;
      if (this.lower >= 1) {
        this.lower = 1;
        this.current.onUnequip();
        this.current.view.visible = false;
        this.index = this.target;
        this.current.view.visible = true;
        this.state = 'raising';
      }
    } else if (this.state === 'raising') {
      this.lower -= dt * 6;
      if (this.lower <= 0) { this.lower = 0; this.state = 'idle'; }
    }

    const w = this.current;
    const held = input.mouseDown(0);
    const clicked = input.consumeClick(0);
    const reloadKey = input.consumePress('KeyR');
    if (this.state === 'idle') {
      if (reloadKey) w.reload(ctx);
      w.primary(w.def.auto ? held : clicked, ctx);
    }
    w.update(dt, ctx);

    this.bobT += dt * (2 + player.speed * 1.2);
    const k = Math.min(1, player.speed / 4) * (player.grounded ? 1 : 0.3);
    w.applyPose(Math.sin(this.bobT) * 0.008 * k, Math.sin(this.bobT * 2) * 0.006 * k, this.lower);
  }

  setPrewarm(on: boolean) { for (const w of this.weapons) w.setPrewarm(on); }

  reset() {
    for (const w of this.weapons) { w.reset(); w.view.visible = false; }
    this.index = 0; this.target = 0; this.state = 'idle'; this.lower = 0;
    this.weapons[0].view.visible = true;
  }
}
