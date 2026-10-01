export type AmmoType = 'pistol' | 'none';

/** Pure data describing a weapon. Add a new weapon = add a def (+ a class if it behaves differently). */
export interface WeaponDef {
  id: string;
  name: string;
  kind: 'ranged' | 'melee';
  damage: number;
  range: number;
  cooldown: number;        // seconds between attacks
  auto: boolean;           // hold to keep firing
  headshotMult: number;
  ammoType: AmmoType;
  magSize: number;
  startReserve: number;
  maxReserve: number;
  reloadTime: number;
  spread: number;          // radians (random cone)
  pellets: number;         // >1 = shotgun style
  recoilKick: number;      // camera kick (radians)
  noiseRadius: number;     // how far zombies hear it
  meleeArc: number;        // melee: cosine of the half-angle of the hit cone
  hitDelay: number;        // melee: seconds after swing start when the hit lands
}

export const PISTOL: WeaponDef = {
  id: 'pistol', name: 'PISTOL', kind: 'ranged',
  damage: 34, range: 120, cooldown: 0.22, auto: false, headshotMult: 2.5,
  ammoType: 'pistol', magSize: 12, startReserve: 48, maxReserve: 120, reloadTime: 1.4,
  spread: 0.006, pellets: 1, recoilKick: 0.018, noiseRadius: 45, meleeArc: 0, hitDelay: 0,
};

export const KNIFE: WeaponDef = {
  id: 'knife', name: 'KNIFE', kind: 'melee',
  damage: 50, range: 2.4, cooldown: 0.55, auto: false, headshotMult: 1,
  ammoType: 'none', magSize: 0, startReserve: 0, maxReserve: 0, reloadTime: 0,
  spread: 0, pellets: 0, recoilKick: 0, noiseRadius: 8, meleeArc: 0.55, hitDelay: 0.14,
};

/* Example of a future weapon:
export const SHOTGUN: WeaponDef = {
  id: 'shotgun', name: 'SHOTGUN', kind: 'ranged', damage: 14, range: 40, cooldown: 0.9, auto: false,
  headshotMult: 1.5, ammoType: 'shell', magSize: 6, startReserve: 24, maxReserve: 60, reloadTime: 2.2,
  spread: 0.06, pellets: 8, recoilKick: 0.06, noiseRadius: 60, meleeArc: 0, hitDelay: 0,
};
*/
