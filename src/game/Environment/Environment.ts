import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../Physics/PhysicsWorld';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rect { x: number; z: number; hx: number; hz: number }
interface DynProp { mesh: THREE.Mesh; body: RAPIER.RigidBody }

const ROAD_HALF = 5;
const WORLD_HALF = 100;

/**
 * Procedural abandoned night-time city.
 * - Repeated objects (windows, lane marks, poles, trees) are InstancedMeshes.
 * - Static objects have frozen matrices (no per-frame matrix updates).
 * - Every solid has a Rapier collider; barrels/crates are real dynamic bodies you can shoot and push.
 */
export class Environment {
  readonly group = new THREE.Group();
  private dynGroup = new THREE.Group();
  private rng = mulberry32(1337);
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  private coneGeo = new THREE.ConeGeometry(1, 1, 8);
  private mats = new Map<number, THREE.MeshStandardMaterial>();
  private occupied: Rect[] = [];
  private moon!: THREE.Mesh;
  private stars!: THREE.Points;
  private moonDir = new THREE.Vector3(-0.5, 0.6, -0.6).normalize();
  private dyn: DynProp[] = [];
  private tmpObj = new THREE.Object3D();

  constructor(private scene: THREE.Scene, private physics: PhysicsWorld) {
    this.scene.add(this.group);
    this.scene.add(this.dynGroup);
    this.buildAtmosphere();
    this.buildGround();
    this.buildBuildings();
    this.buildPerimeter();
    this.buildStreetLights();
    this.buildVehiclesAndProps();
    this.buildRuins();
    this.buildTrees();
    // Freeze all static matrices: they never change, so skip recomputing them each frame
    this.group.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    this.buildDynamicProps();
  }

  // ---------- helpers ----------
  private mat(color: number, rough = 0.9) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 }); this.mats.set(color, m); }
    return m;
  }

  /** Box mesh + static collider. Base sits at y0. */
  private box(w: number, h: number, d: number, x: number, z: number, color: number, rot = 0, y0 = 0, collide = true) {
    const mesh = new THREE.Mesh(this.boxGeo, this.mat(color));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y0 + h / 2, z);
    mesh.rotation.y = rot;
    this.group.add(mesh);
    if (collide) this.physics.addStaticBox(x, y0 + h / 2, z, w / 2, h / 2, d / 2, rot);
    return mesh;
  }

  private m4(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
    const o = this.tmpObj;
    o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.scale.set(sx, sy, sz); o.updateMatrix();
    return o.matrix.clone();
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[]) {
    if (!ms.length) return;
    const im = new THREE.InstancedMesh(geo, mat, ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    this.group.add(im);
  }

  private isFree(x: number, z: number, r: number) {
    if (Math.abs(x) < ROAD_HALF + r + 1 || Math.abs(z) < ROAD_HALF + r + 1) return false;
    if (Math.abs(x) > WORLD_HALF - 6 || Math.abs(z) > WORLD_HALF - 6) return false;
    return !this.occupied.some(o => Math.abs(x - o.x) < o.hx + r && Math.abs(z - o.z) < o.hz + r);
  }

  // ---------- atmosphere ----------
  private buildAtmosphere() {
    const sky = 0x05070d;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.FogExp2(sky, 0.022);

    this.scene.add(new THREE.HemisphereLight(0x2a3a66, 0x0a0a0c, 0.45));
    const moonLight = new THREE.DirectionalLight(0x8fa3ff, 0.55);
    moonLight.position.copy(this.moonDir).multiplyScalar(100);
    this.scene.add(moonLight);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(14, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    this.scene.add(this.moon);

    // Stars: fixed on a huge sphere that follows the camera
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = this.rng() * 2 - 1, a = this.rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos[i * 3] = Math.cos(a) * r * 450; pos[i * 3 + 1] = y * 450; pos[i * 3 + 2] = Math.sin(a) * r * 450;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaabbdd, size: 1.6, sizeAttenuation: false, fog: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  /** Moon/stars follow the camera (infinitely far); dynamic props sync from physics. */
  update(camPos: THREE.Vector3) {
    this.moon.position.copy(camPos).addScaledVector(this.moonDir, 420);
    this.stars.position.copy(camPos);
    for (const d of this.dyn) {
      if (d.body.isSleeping()) continue;
      const t = d.body.translation(), r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // ---------- ground + roads ----------
  private buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2 + 20, WORLD_HALF * 2 + 20), this.mat(0x1a1c1a, 1));
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);
    // Thick ground collider, top surface at y = 0
    this.physics.addStaticBox(0, -1, 0, WORLD_HALF + 10, 1, WORLD_HALF + 10);

    const road = this.mat(0x0d0d0f, 0.8);
    const addRoad = (w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), road);
      m.rotation.x = -Math.PI / 2; m.position.y = 0.02; this.group.add(m);
    };
    addRoad(ROAD_HALF * 2, WORLD_HALF * 2);
    addRoad(WORLD_HALF * 2, ROAD_HALF * 2);

    // Lane markings (dashed) as two instanced meshes
    const paint = new THREE.MeshBasicMaterial({ color: 0x6b6a52 });
    const dashA: THREE.Matrix4[] = [], dashB: THREE.Matrix4[] = [];
    for (let t = -WORLD_HALF + 4; t < WORLD_HALF; t += 6) {
      if (Math.abs(t) < ROAD_HALF + 1) continue;
      dashA.push(this.m4(0, 0.03, t, 1, 1, 1));
      dashB.push(this.m4(t, 0.03, 0, 1, 1, 1));
    }
    this.instanced(new THREE.PlaneGeometry(0.25, 2.5).rotateX(-Math.PI / 2), paint, dashA);
    this.instanced(new THREE.PlaneGeometry(2.5, 0.25).rotateX(-Math.PI / 2), paint, dashB);
  }

  // ---------- buildings ----------
  private buildBuildings() {
    const colors = [0x2a2d36, 0x33302d, 0x26292b, 0x2f3338, 0x3a3532];
    const windows: THREE.Matrix4[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const cx = sx * (16 + i * 28);
        const cz = sz * (16 + j * 28);
        if (this.rng() < 0.18) continue; // empty lot (filled with ruins/props/trees later)
        const w = 10 + this.rng() * 6;
        const d = 10 + this.rng() * 6;
        const h = 6 + this.rng() * 16;
        const color = colors[Math.floor(this.rng() * colors.length)];
        this.box(w, h, d, cx, cz, color);
        this.box(w + 0.6, 0.6, d + 0.6, cx, cz, 0x1c1c1e, 0, h, false); // roof lip
        // a few dim lit windows on the face toward the cross road
        for (let n = 0; n < 4; n++) {
          if (this.rng() < 0.6) continue;
          windows.push(this.m4(cx + (this.rng() - 0.5) * (w - 3), 2.5 + this.rng() * (h - 4) + 0.8, cz - sz * (d / 2 + 0.06), 1.4, 1.6, 0.1));
        }
        this.occupied.push({ x: cx, z: cz, hx: w / 2 + 1, hz: d / 2 + 1 });
      }
    this.instanced(this.boxGeo, new THREE.MeshBasicMaterial({ color: 0x6b5a2a }), windows);
  }

  private buildPerimeter() {
    const t = 2, h = 6, L = WORLD_HALF + t;
    this.box(L * 2, h, t, 0, -L, 0x1e1f22);
    this.box(L * 2, h, t, 0, L, 0x1e1f22);
    this.box(t, h, L * 2, -L, 0, 0x1e1f22);
    this.box(t, h, L * 2, L, 0, 0x1e1f22);
  }

  // ---------- street lights ----------
  private buildStreetLights() {
    const poles: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = [];
    const spots: [number, number][] = [];
    for (let t = -60; t <= 60; t += 20) {
      if (Math.abs(t) < 8) continue;
      spots.push([t, 6.5], [t, -6.5], [6.5, t], [-6.5, t]);
    }
    let lit = 0;
    for (const [x, z] of spots) {
      poles.push(this.m4(x, 3, z, 0.12, 6, 0.12));
      heads.push(this.m4(x, 6.1, z, 0.9, 0.18, 0.4));
      this.physics.addStaticBox(x, 3, z, 0.15, 3, 0.15);
      // Real lights only for a few lamps near spawn (each point light costs every fragment)
      if (Math.abs(x) + Math.abs(z) <= 30 && lit++ % 2 === 0) {
        const l = new THREE.PointLight(0xffc27a, 28, 26, 2);
        l.position.set(x, 5.8, z); this.group.add(l);
      }
    }
    this.instanced(this.cylGeo, this.mat(0x222226), poles);
    this.instanced(this.boxGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), heads);
  }

  // ---------- cars, containers, barriers, crates ----------
  private buildVehiclesAndProps() {
    const carColors = [0x3b2a2a, 0x2a3340, 0x35372f, 0x40403f];
    for (let n = 0; n < 12; n++) {
      const alongX = n % 2 === 0;
      const t = (this.rng() < 0.5 ? -1 : 1) * (14 + this.rng() * 60);
      const lane = (this.rng() < 0.5 ? -1 : 1) * 2.6;
      const x = alongX ? t : lane, z = alongX ? lane : t;
      const rot = (alongX ? 0 : Math.PI / 2) + (this.rng() - 0.5) * 0.5;
      const c = carColors[n % carColors.length];
      this.box(4.2, 0.9, 1.9, x, z, c, rot, 0.35, true);
      const cabin = this.box(2.2, 0.7, 1.7, x, z, 0x15181c, rot, 1.25, false);
      cabin.translateX(-0.2);
    }

    const contColors = [0x6a3a2a, 0x2f4a55, 0x55512a, 0x4a2f2f];
    let placed = 0, tries = 0;
    while (placed < 14 && tries++ < 400) {
      const x = (this.rng() - 0.5) * 170, z = (this.rng() - 0.5) * 170;
      if (!this.isFree(x, z, 4)) continue;
      const rot = this.rng() * Math.PI;
      this.box(6, 2.6, 2.4, x, z, contColors[placed % 4], rot);
      if (this.rng() < 0.3) this.box(6, 2.6, 2.4, x, z, contColors[(placed + 1) % 4], rot, 2.6); // stacked
      this.occupied.push({ x, z, hx: 4, hz: 4 });
      placed++;
    }

    const barriers: [number, number, number][] = [[-9, 12, 0.3], [10, -11, -0.4], [12, 14, 0.8], [-13, -9, 1.2]];
    for (const [x, z, r] of barriers) this.box(3.5, 1.1, 0.7, x, z, 0x4a4a48, r);
  }

  // ---------- ruined walls + rubble in empty lots ----------
  private buildRuins() {
    let placed = 0, tries = 0;
    while (placed < 9 && tries++ < 300) {
      const x = (this.rng() - 0.5) * 170, z = (this.rng() - 0.5) * 170;
      if (!this.isFree(x, z, 4)) continue;
      const rot = this.rng() * Math.PI;
      const len = 4 + this.rng() * 4, h = 1.4 + this.rng() * 2;
      this.box(len, h, 0.5, x, z, 0x3a3836, rot);
      const nx = Math.cos(rot), nz = -Math.sin(rot); // along the wall
      this.box(len * 0.4, h * 0.6, 0.5, x + nx * len * 0.65, z + nz * len * 0.65, 0x3a3836, rot + 0.1); // broken extension
      for (let k = 0; k < 4; k++) {
        const s = 0.3 + this.rng() * 0.5;
        this.box(s, s * 0.7, s, x + (this.rng() - 0.5) * 5, z + (this.rng() - 0.5) * 5, 0x4a4743, this.rng() * 3);
      }
      this.occupied.push({ x, z, hx: 5, hz: 5 });
      placed++;
    }
    // static crates scattered around
    for (let n = 0; n < 14; n++) {
      const x = (this.rng() - 0.5) * 150, z = (this.rng() - 0.5) * 150;
      if (!this.isFree(x, z, 1.2)) continue;
      const s = 0.8 + this.rng() * 0.8;
      this.box(s, s, s, x, z, 0x4b3a26, this.rng() * Math.PI);
      this.occupied.push({ x, z, hx: s, hz: s });
    }
  }

  // ---------- trees (instanced) ----------
  private buildTrees() {
    const trunks: THREE.Matrix4[] = [], leaves: THREE.Matrix4[] = [];
    let placed = 0, tries = 0;
    while (placed < 45 && tries++ < 600) {
      const x = (this.rng() - 0.5) * 185, z = (this.rng() - 0.5) * 185;
      if (!this.isFree(x, z, 1.5)) continue;
      const h = 4 + this.rng() * 3;
      trunks.push(this.m4(x, h * 0.25, z, 0.25, h * 0.5, 0.25));
      for (let k = 0; k < 3; k++) {
        const r = 1.9 - k * 0.5;
        leaves.push(this.m4(x, h * 0.5 + k * 1.2 + 0.8, z, r, 2.2, r));
      }
      this.physics.addStaticBox(x, 1.5, z, 0.3, 1.5, 0.3);
      this.occupied.push({ x, z, hx: 1.2, hz: 1.2 });
      placed++;
    }
    this.instanced(this.cylGeo, this.mat(0x2b1f16), trunks);
    this.instanced(this.coneGeo, this.mat(0x14261a), leaves);
  }

  // ---------- dynamic physics props (barrels + crates) ----------
  private spotFree(x: number, y: number, z: number, hx: number, hy: number, hz: number) {
    if (Math.hypot(x, z - 8) < 3.5) return false; // keep the player spawn clear
    this.physics.world.updateSceneQueries(); // colliders created this tick must be visible to the query
    const shape = new this.physics.RAPIER.Cuboid(hx, hy, hz);
    return !this.physics.world.intersectionWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape);
  }

  private addDynamic(mesh: THREE.Mesh, desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    const { world, RAPIER } = this.physics;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.5).setAngularDamping(0.7)
    );
    world.createCollider(desc.setFriction(0.8).setRestitution(0.1), body);
    mesh.position.set(x, y, z);
    this.dynGroup.add(mesh);
    this.dyn.push({ mesh, body });
  }

  private buildDynamicProps() {
    const { RAPIER } = this.physics;
    const barrelColors = [0x6a2a22, 0x2a4a5a, 0x4a5a2a];
    const barrels: [number, number][] = [[3, -10], [-3, -18], [2.5, 16], [-2, 26], [14, 2.5], [-16, -2.2], [24, -3], [-30, 3], [3, 40], [-3, -48], [-22, 3.5], [-7, 3]];
    barrels.forEach(([x, z], i) => {
      if (!this.spotFree(x, 0.56, z, 0.4, 0.5, 0.4)) return;
      const mesh = new THREE.Mesh(this.cylGeo, this.mat(barrelColors[i % 3], 0.6));
      mesh.scale.set(0.35, 1.0, 0.35);
      this.addDynamic(mesh, RAPIER.ColliderDesc.cylinder(0.5, 0.35).setDensity(25), x, 0.51, z);
    });

    const crateMat = this.mat(0x6b4f2e);
    const stacks: [number, number, number][] = [[-5, 3, 2], [5.5, -3, 3], [-12, -3.6, 1], [20, 3.4, 2]]; // x, z, height
    for (const [x, z, n] of stacks) {
      for (let k = 0; k < n; k++) {
        if (!this.spotFree(x, 0.55 + k * 1.02, z, 0.5, 0.48, 0.5)) break;
        const mesh = new THREE.Mesh(this.boxGeo, crateMat);
        this.addDynamic(mesh, RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(12), x + (this.rng() - 0.5) * 0.1, 0.51 + k * 1.02, z);
      }
    }
  }
}
