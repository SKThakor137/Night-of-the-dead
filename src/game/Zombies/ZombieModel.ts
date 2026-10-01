import * as THREE from 'three';
import type { ZombieType, ZombieStats } from './ZombieTypes';

const box = new THREE.BoxGeometry(1, 1, 1);
type Kind = 'skin' | 'shirt' | 'pants' | 'blood' | 'hair' | 'armor';

const PALETTE: Record<ZombieType, Record<Kind, number>> = {
  walker: { skin: 0x6f8a5c, shirt: 0x3a3f4d, pants: 0x2a2a30, blood: 0x4a0b0b, hair: 0x1a1410, armor: 0x2e2f33 },
  runner: { skin: 0x8a9a6a, shirt: 0x5a2e2e, pants: 0x33302a, blood: 0x4a0b0b, hair: 0x2a2018, armor: 0x2e2f33 },
  brute:  { skin: 0x5a6f55, shirt: 0x24282a, pants: 0x1c1c20, blood: 0x3a0808, hair: 0x101010, armor: 0x3a3b40 },
};
const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(type: ZombieType, kind: Kind) {
  const key = type + kind;
  let m = mats.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: PALETTE[type][kind], roughness: 0.95 }); mats.set(key, m); }
  return m;
}
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a00, fog: false });

export interface ZombieModel {
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  headMesh: THREE.Mesh;
  hitMeshes: THREE.Mesh[];
  parts: { mesh: THREE.Mesh; kind: Kind }[];
  extras: { mesh: THREE.Mesh; types: ZombieType[] }[];
}

/** Procedural humanoid from shared boxes. Faces +Z, feet at y = 0. Detail pieces are visible per zombie type. */
export function buildZombieModel(root: THREE.Group): ZombieModel {
  const parts: ZombieModel['parts'] = [];
  const hitMeshes: THREE.Mesh[] = [];
  const extras: ZombieModel['extras'] = [];
  const mk = (kind: Kind, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D, hit = true, only?: ZombieType[]) => {
    const m = new THREE.Mesh(box, mat('walker', kind));
    m.scale.set(w, h, d); m.position.set(x, y, z);
    parent.add(m); parts.push({ mesh: m, kind });
    if (hit) hitMeshes.push(m);
    if (only) extras.push({ mesh: m, types: only });
    return m;
  };
  const pivot = (x: number, y: number, z: number, parent: THREE.Object3D) => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
  };

  const legL = pivot(-0.13, 0.8, 0, root);
  const legR = pivot(0.13, 0.8, 0, root);
  mk('pants', 0.18, 0.8, 0.2, 0, -0.4, 0, legL);
  mk('pants', 0.18, 0.8, 0.2, 0, -0.4, 0, legR);
  mk('blood', 0.19, 0.22, 0.21, 0, -0.55, 0, legR, false);   // blood-stained shin
  mk('skin', 0.19, 0.12, 0.21, 0, -0.74, 0, legL, false);    // torn trouser: bare ankle

  const torsoPivot = pivot(0, 0.8, 0, root);
  mk('shirt', 0.5, 0.66, 0.26, 0, 0.33, 0, torsoPivot);
  mk('blood', 0.24, 0.26, 0.275, 0.08, 0.38, 0, torsoPivot, false);   // chest wound
  mk('skin', 0.2, 0.1, 0.275, -0.1, 0.1, 0, torsoPivot, false);       // torn shirt: exposed belly
  mk('armor', 0.8, 0.14, 0.34, 0, 0.62, 0, torsoPivot, false, ['brute']); // brute shoulder slab

  const armL = pivot(-0.33, 0.58, 0, torsoPivot);
  const armR = pivot(0.33, 0.58, 0, torsoPivot);
  mk('skin', 0.13, 0.6, 0.13, 0, -0.28, 0, armL);
  mk('skin', 0.13, 0.6, 0.13, 0, -0.28, 0, armR);
  mk('blood', 0.14, 0.18, 0.14, 0, -0.45, 0, armR, false);

  const headPivot = pivot(0, 0.66, 0, torsoPivot);
  const headMesh = mk('skin', 0.27, 0.27, 0.27, 0, 0.16, 0, headPivot);
  mk('skin', 0.2, 0.06, 0.2, 0, 0.0, 0.05, headPivot, false);                        // hanging jaw
  mk('hair', 0.285, 0.08, 0.285, 0, 0.3, -0.01, headPivot, false, ['walker', 'runner']); // matted hair
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(box, eyeMat);
    e.scale.set(0.05, 0.03, 0.02); e.position.set(sx * 0.06, 0.19, 0.14);
    headPivot.add(e);
  }
  return { torsoPivot, headPivot, armL, armR, legL, legR, headMesh, hitMeshes, parts, extras };
}

export function applyZombieType(model: ZombieModel, root: THREE.Object3D, type: ZombieType, s: ZombieStats) {
  for (const p of model.parts) p.mesh.material = mat(type, p.kind);
  for (const e of model.extras) e.mesh.visible = e.types.includes(type);
  root.scale.set(s.scaleW, s.scaleH, s.scaleW);
}
