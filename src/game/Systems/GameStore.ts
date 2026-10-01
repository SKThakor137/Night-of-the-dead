/**
 * Tiny external store that bridges the Three.js game loop and React.
 * The game writes coarse HUD values; React subscribes via useSyncExternalStore.
 * `set` only notifies when a value really changed, so the HUD re-renders rarely.
 */
export type Phase = 'loading' | 'menu' | 'playing' | 'dead';

export interface HudState {
  phase: Phase;
  locked: boolean;
  health: number;
  maxHealth: number;
  weaponName: string;
  weaponKind: 'ranged' | 'melee';
  ammo: number;
  reserve: number;
  reloading: boolean;
  slot: number;
  slots: string[];
  wave: number;
  remaining: number;
  score: number;
  banner: string;
  bannerSub: string;
  flashlight: boolean;
  damageTick: number;
  hitTick: number;
  killTick: number;
  finalScore: number;
  finalWave: number;
  showFps: boolean;
  fps: number;
}

export const initialHud: HudState = {
  phase: 'loading', locked: false, health: 100, maxHealth: 100,
  weaponName: '', weaponKind: 'ranged', ammo: 0, reserve: 0, reloading: false,
  slot: 0, slots: [], wave: 0, remaining: 0, score: 0, banner: '', bannerSub: '',
  flashlight: true, damageTick: 0, hitTick: 0, killTick: 0, finalScore: 0, finalWave: 0, showFps: false, fps: 0,
};

export class GameStore {
  private state: HudState = { ...initialHud };
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  set(patch: Partial<HudState>) {
    let changed = false;
    for (const k in patch) {
      const key = k as keyof HudState;
      if (this.state[key] !== patch[key]) { changed = true; break; }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l());
  }
}
