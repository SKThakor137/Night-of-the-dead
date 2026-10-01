import * as THREE from 'three';
import { PhysicsWorld } from '../Physics/PhysicsWorld';
import { PlayerController } from '../Player/PlayerController';
import { PlayerHealth } from '../Player/PlayerHealth';
import { ZombieSpawner } from '../Zombies/ZombieSpawner';
import { Zombie } from '../Zombies/Zombie';
import { WaveManager } from './WaveManager';
import { Environment } from '../Environment/Environment';
import { Input } from './Input';
import { GameStore } from './GameStore';
import { Combat } from './Combat';
import { Effects } from './Effects';
import { AudioManager } from '../Audio/AudioManager';
import { WeaponManager } from '../Weapons/WeaponManager';
import { WeaponContext } from '../Weapons/Weapon';
import { Gun } from '../Weapons/Gun';
import { Knife } from '../Weapons/Knife';
import { Flashlight } from '../Player/Flashlight';
import { PISTOL, KNIFE } from '../Weapons/WeaponDefs';

const SPAWN = new THREE.Vector3(0, 1.0, 8);

/**
 * Owns renderer, scenes, physics and the main loop. Runs entirely outside React;
 * React only sees coarse HUD values through GameStore.
 */
export class GameManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private weaponScene = new THREE.Scene();   // view models, drawn on top with a cleared depth buffer
  private viewRoot = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private locked = false;
  private phase: 'menu' | 'playing' | 'dead' = 'menu';
  private score = 0;
  private bannerT = 0;
  private stepDist = 0;
  private hbT = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fwdTmp = new THREE.Vector3();
  private flashlight!: Flashlight;

  private physics!: PhysicsWorld;
  private player!: PlayerController;
  private env!: Environment;
  private input!: Input;
  private audio!: AudioManager;
  private effects!: Effects;
  private combat!: Combat;
  private health = new PlayerHealth();
  private spawner!: ZombieSpawner;
  private waves!: WaveManager;
  private weapons!: WeaponManager;
  private weaponCtx!: WeaponContext;

  private constructor(private container: HTMLElement, private store: GameStore) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 600);
    this.scene.add(this.camera);

    this.weaponScene.add(new THREE.HemisphereLight(0xaabbdd, 0x222233, 1.1));
    const d = new THREE.DirectionalLight(0xffffff, 0.6);
    d.position.set(1, 2, 1);
    this.weaponScene.add(d);
    this.weaponScene.add(this.viewRoot);
  }

  /**
   * `aborted` lets the caller cancel (React StrictMode mounts, unmounts and remounts immediately).
   * Returns null when aborted before anything was built, so no world is created and later freed.
   */
  static async create(container: HTMLElement, store: GameStore, aborted?: () => boolean): Promise<GameManager | null> {
    await PhysicsWorld.load();
    if (aborted?.()) return null;
    const g = new GameManager(container, store);
    g.physics = await PhysicsWorld.create();
    g.env = new Environment(g.scene, g.physics);
    g.input = new Input();
    g.audio = new AudioManager();
    g.effects = new Effects(g.scene);
    g.player = new PlayerController(g.camera, g.physics, SPAWN.clone(), g.input);
    g.spawner = new ZombieSpawner(g.physics, g.scene, g.audio);
    g.flashlight = new Flashlight(g.camera);
    g.combat = new Combat(g.physics, g.player.body, g.spawner.pool, g.effects, g.audio);
    g.combat.onDamage = (t, _dmg, head, killed) => {
      if (t instanceof Zombie) g.score += 10 + (killed ? t.stats.score + (head ? 50 : 0) : 0);
      const s = g.store.getSnapshot();
      g.store.set({ hitTick: s.hitTick + 1, killTick: killed ? s.killTick + 1 : s.killTick });
    };

    g.waves = new WaveManager(g.spawner, {
      onWaveStart: (n, count) => { g.audio.waveStart(); g.showBanner(`WAVE ${n}`, `${count} ZOMBIES`, 3.5); },
      onWaveCleared: (n) => {
        const bonus = 250 * n;
        g.score += bonus;
        g.health.heal(20);
        g.weapons.addAmmo('pistol', 30);
        g.showBanner(`WAVE ${n} CLEARED`, `+${bonus} SCORE  ·  +20 HEALTH  ·  +30 AMMO`, 5);
      },
    });

    // Zombies read player state through this shared context
    g.spawner.ctx.playerPos = g.player.pos;
    g.spawner.ctx.damagePlayer = (amount) => g.health.damage(amount);
    g.health.onDamage = () => {
      g.audio.hurt();
      g.player.addShake(0.07);
      g.store.set({ damageTick: g.store.getSnapshot().damageTick + 1 });
    };
    g.health.onDeath = () => g.die();

    g.weapons = new WeaponManager(g.viewRoot).register(new Gun(PISTOL)).register(new Knife(KNIFE));
    g.weaponCtx = {
      camera: g.camera, player: g.player, combat: g.combat, effects: g.effects, audio: g.audio,
      alert: (pos, radius) => g.spawner.alertAround(pos, radius),
    };

    // Pre-warm so the first shot never compiles shaders mid-game
    for (const t of g.effects.tracers) t.mesh.visible = true;
    g.renderer.compile(g.scene, g.camera);
    for (const t of g.effects.tracers) t.mesh.visible = false;
    g.weapons.setPrewarm(true);
    g.renderer.compile(g.weaponScene, g.camera);
    g.weapons.setPrewarm(false);

    window.addEventListener('resize', g.onResize);
    document.addEventListener('pointerlockchange', g.onLockChange);
    g.store.set({ phase: 'menu', slots: g.weapons.slotNames });
    g.clock.start();
    g.loop();
    return g;
  }

  requestLock() {
    this.audio.resume();
    this.renderer.domElement.requestPointerLock();
  }

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    this.locked = locked;
    this.player.setEnabled(locked);
    this.input.setActive(locked && this.phase !== 'dead');
    if (locked && this.phase === 'menu') {
      this.phase = 'playing';
      this.store.set({ phase: 'playing' });
      this.startRun();
    }
    this.store.set({ locked });
  };

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private simulate(dt: number) {
    this.player.update(dt);
    this.camera.updateMatrixWorld(true);
    if (this.input.consumePress('F3')) this.store.set({ showFps: !this.store.getSnapshot().showFps });
    if (this.health.value < 30 && !this.health.dead && (this.hbT -= dt) <= 0) {
      this.audio.heartbeat();
      this.hbT = 0.55 + this.health.value / 60;
    }
    if (this.input.consumePress('KeyF')) { this.flashlight.toggle(); this.audio.flashlight(); }
    this.flashlight.update(dt);
    this.weapons.update(dt, this.weaponCtx, this.input, this.player);

    // footsteps + 3D audio listener
    if (this.player.grounded && this.player.speed > 1.5) {
      this.stepDist += this.player.speed * dt;
      if (this.stepDist > (this.player.sprinting ? 2.6 : 2.0)) { this.stepDist = 0; this.audio.step(); }
    }
    this.camera.getWorldDirection(this.fwdTmp);
    this.audio.setListener(this.camera.position, this.fwdTmp);

    const zc = this.spawner.ctx;
    zc.playerAlive = !this.health.dead;
    zc.playerSprinting = this.player.sprinting;
    this.spawner.update(dt);
    this.waves.update(dt, this.player.pos);
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.store.set({ banner: '', bannerSub: '' });

    this.physics.step(dt);
    this.effects.update(dt);
    this.syncHud();
  }

  private showBanner(title: string, sub: string, seconds: number) {
    this.bannerT = seconds;
    this.store.set({ banner: title, bannerSub: sub });
  }

  private startRun() {
    this.score = 0;
    this.waves.start();
    this.showBanner('NIGHT FALLS', 'SURVIVE', 3);
  }

  private die() {
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.audio.death();
    this.input.setActive(false);
    this.store.set({ phase: 'dead', health: 0, banner: '', bannerSub: '', finalScore: this.score, finalWave: this.waves.wave });
    if (document.pointerLockElement) document.exitPointerLock();
  }

  restart() {
    this.health.reset();
    this.player.respawn(SPAWN);
    this.weapons.reset();
    this.spawner.reset();
    this.effects.reset();
    this.flashlight.set(true);
    this.phase = 'playing';
    this.store.set({ phase: 'playing', health: this.health.max, damageTick: 0, hitTick: 0, killTick: 0, banner: '', bannerSub: '' });
    this.startRun();
    this.requestLock();
  }

  private syncHud() {
    const w = this.weapons.current;
    const h = w.getHud();
    this.store.set({
      weaponName: w.def.name, weaponKind: w.def.kind,
      ammo: h.ammo, reserve: h.reserve, reloading: h.reloading, slot: this.weapons.index,
      health: Math.ceil(this.health.value), maxHealth: this.health.max,
      flashlight: this.flashlight.on, remaining: this.waves.remaining, wave: this.waves.wave, score: this.score,
    });
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 1 / 30);
    this.fpsFrames++; this.fpsTime += rawDt;
    if (this.fpsTime >= 0.5) {
      if (this.store.getSnapshot().showFps) this.store.set({ fps: Math.round(this.fpsFrames / this.fpsTime) });
      this.fpsFrames = 0; this.fpsTime = 0;
    }

    if (this.phase === 'playing' && this.locked) this.simulate(dt);
    else if (this.phase === 'dead') {
      this.player.updateDeadCam(dt);
      this.effects.update(dt);
    }
    this.env.update(this.camera.position);

    this.viewRoot.position.copy(this.camera.position);
    this.viewRoot.quaternion.copy(this.camera.quaternion);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.phase === 'playing') {
      this.renderer.clearDepth();
      this.renderer.render(this.weaponScene, this.camera);
    }
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.input?.dispose();
    this.player?.dispose();
    this.physics?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
