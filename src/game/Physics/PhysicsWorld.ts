import RAPIER from '@dimforge/rapier3d-compat';

/** Thin wrapper around the Rapier world so the rest of the game never deals with init/boilerplate. */
export class PhysicsWorld {
  readonly RAPIER = RAPIER;
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
  }

  private static initPromise: Promise<void> | null = null;

  /** Loads the Rapier WASM exactly once (React StrictMode calls create() twice at the same time in dev). */
  static load(): Promise<void> {
    if (!PhysicsWorld.initPromise) {
      PhysicsWorld.initPromise = RAPIER.init().catch(e => { PhysicsWorld.initPromise = null; throw e; });
    }
    return PhysicsWorld.initPromise;
  }

  static async create(): Promise<PhysicsWorld> {
    await PhysicsWorld.load();
    return new PhysicsWorld();
  }

  /** Static axis-aligned (optionally Y-rotated) box. `half` = half extents. */
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) });
    return this.world.createCollider(desc);
  }

  step(dt: number) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }

  private freed = false;
  dispose() {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }
}
