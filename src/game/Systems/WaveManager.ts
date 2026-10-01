import type * as THREE from 'three';
import type { ZombieSpawner } from '../Zombies/ZombieSpawner';
import type { ZombieType, ZombieWaveMods } from '../Zombies/ZombieTypes';

export interface WaveConfig {
  count: number;
  maxAlive: number;       // zombies alive at once (rest are queued)
  spawnInterval: number;  // seconds between spawns
  mods: ZombieWaveMods;
  weights: Record<ZombieType, number>;
}

/**
 * Wave 1 → 5 zombies, Wave 2 → 10, Wave 3 → 15,
 * Wave 4 → faster zombies, Wave 5+ → stronger (more health and damage).
 */
export function getWaveConfig(n: number): WaveConfig {
  const count = n <= 3 ? n * 5 : 15 + (n - 4) * 3;
  const speed = n >= 4 ? Math.min(1.35 + (n - 4) * 0.08, 1.9) : 1;
  const strong = n >= 5 ? 1.5 + (n - 5) * 0.25 : 1;
  return {
    count,
    maxAlive: Math.min(8 + n * 2, 18),
    spawnInterval: Math.max(0.6, 1.4 - n * 0.1),
    mods: { speed, hp: strong, damage: 1 + (strong - 1) * 0.6 },
    weights: {
      walker: 1,
      runner: n >= 2 ? Math.min(0.2 + (n - 2) * 0.1, 0.5) : 0,
      brute: n >= 3 ? Math.min(0.08 + (n - 3) * 0.05, 0.25) : 0,
    },
  };
}

export interface WaveEvents {
  onWaveStart: (wave: number, count: number) => void;
  onWaveCleared: (wave: number) => void;
}

const INTERMISSION = 6;

export class WaveManager {
  wave = 0;
  state: 'idle' | 'intermission' | 'active' = 'idle';
  private timer = 0;
  private toSpawn = 0;
  private spawnTimer = 0;
  private cfg: WaveConfig = getWaveConfig(1);

  constructor(private spawner: ZombieSpawner, private ev: WaveEvents) {}

  /** Zombies still to kill: queued + alive. */
  get remaining() { return this.toSpawn + this.spawner.aliveCount; }

  start() {
    this.wave = 0; this.toSpawn = 0;
    this.state = 'intermission';
    this.timer = 3;
  }

  reset() {
    this.wave = 0; this.toSpawn = 0; this.state = 'idle';
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
    } else if (this.state === 'active') {
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && this.spawnTimer <= 0 && this.spawner.aliveCount < this.cfg.maxAlive) {
        if (this.spawner.spawn(this.pickType(), this.cfg.mods, playerPos)) {
          this.toSpawn--;
          this.spawnTimer = this.cfg.spawnInterval;
        } else {
          this.spawnTimer = 0.25; // no free spot right now, retry shortly
        }
      }
      if (this.toSpawn === 0 && this.spawner.aliveCount === 0) {
        this.state = 'intermission';
        this.timer = INTERMISSION;
        this.ev.onWaveCleared(this.wave);
      }
    }
  }

  private startWave() {
    this.wave++;
    this.cfg = getWaveConfig(this.wave);
    this.toSpawn = this.cfg.count;
    this.spawnTimer = 0;
    this.state = 'active';
    this.ev.onWaveStart(this.wave, this.cfg.count);
  }

  private pickType(): ZombieType {
    const w = this.cfg.weights;
    let r = Math.random() * (w.walker + w.runner + w.brute);
    if ((r -= w.walker) < 0) return 'walker';
    if ((r -= w.runner) < 0) return 'runner';
    return 'brute';
  }
}
