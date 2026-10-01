import * as THREE from 'three';

const N = 320; // particle pool size
const TRACERS = 16;

/** Pooled visual effects: bullet tracers, spark/blood particles, muzzle light. No allocations per shot. */
export class Effects {
  readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 2);
  readonly tracers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private tIdx = 0;
  private muzzleT = 0;

  private points: THREE.Points;
  private pPos = new Float32Array(N * 3);
  private pCol = new Float32Array(N * 3);
  private pVel = new Float32Array(N * 3);
  private pLife = new Float32Array(N);
  private pGrav = new Float32Array(N);
  private head = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.muzzleLight);

    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(box, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, mat, life: 0 });
    }

    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers[this.tIdx++ % TRACERS];
    const len = from.distanceTo(to);
    t.mesh.position.lerpVectors(from, to, 0.5);
    t.mesh.scale.set(0.014, 0.014, Math.max(0.01, len));
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.mat.opacity = 0.85;
    t.life = 0.07;
  }

  flashMuzzle(pos: THREE.Vector3) {
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 14;
    this.muzzleT = 0.05;
  }

  /** `dir` = direction the bullet was travelling. */
  burst(point: THREE.Vector3, dir: THREE.Vector3, count: number, kind: 'spark' | 'blood') {
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % N;
      const i3 = i * 3;
      this.pPos[i3] = point.x; this.pPos[i3 + 1] = point.y; this.pPos[i3 + 2] = point.z;
      const s = kind === 'spark' ? 1.5 + Math.random() * 3 : 0.8 + Math.random() * 2;
      const back = kind === 'spark' ? -0.6 : 0.35;
      const spread = kind === 'spark' ? 2.2 : 1.3;
      this.pVel[i3] = dir.x * s * back + (Math.random() - 0.5) * spread;
      this.pVel[i3 + 1] = dir.y * s * back + Math.random() * 1.8;
      this.pVel[i3 + 2] = dir.z * s * back + (Math.random() - 0.5) * spread;
      if (kind === 'spark') { this.pCol[i3] = 1; this.pCol[i3 + 1] = 0.75; this.pCol[i3 + 2] = 0.3; }
      else { this.pCol[i3] = 0.55; this.pCol[i3 + 1] = 0.03; this.pCol[i3 + 2] = 0.03; }
      this.pGrav[i] = kind === 'spark' ? 5 : 9;
      this.pLife[i] = 0.3 + Math.random() * 0.4;
    }
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mat.opacity = (t.life / 0.07) * 0.85;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzleLight.intensity = 0;
    }
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) { this.pPos[i3 + 1] = -1000; any = true; continue; }
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      any = true;
    }
    if (any) (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  reset() {
    this.pLife.fill(0);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -1000;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.muzzleLight.intensity = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
  }
}
