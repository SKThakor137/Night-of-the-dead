export type ZombieType = 'walker' | 'runner' | 'brute';

export interface ZombieStats {
  hp: number;
  speed: number;          // m/s (player walks 4.5, sprints 8)
  damage: number;         // per hit
  attackRange: number;    // horizontal distance (m) between centres
  attackWindup: number;   // seconds until the hit lands
  attackDuration: number; // full attack cycle
  detectRadius: number;
  staggerResist: number;  // 0..1 chance to ignore hit-stagger
  score: number;
  scaleW: number;
  scaleH: number;
}

/** Different zombie types have different damage, speed, health. Waves (Phase 4) multiply these. */
export const ZOMBIE_TYPES: Record<ZombieType, ZombieStats> = {
  walker: { hp: 60,  speed: 2.3, damage: 10, attackRange: 1.6, attackWindup: 0.5, attackDuration: 1.1, detectRadius: 26, staggerResist: 0,   score: 100, scaleW: 1,    scaleH: 1 },
  runner: { hp: 35,  speed: 4.3, damage: 7,  attackRange: 1.5, attackWindup: 0.3, attackDuration: 0.7, detectRadius: 34, staggerResist: 0.2, score: 150, scaleW: 0.92, scaleH: 0.96 },
  brute:  { hp: 160, speed: 1.9, damage: 22, attackRange: 1.9, attackWindup: 0.7, attackDuration: 1.5, detectRadius: 22, staggerResist: 0.6, score: 300, scaleW: 1.3,  scaleH: 1.15 },
};

export interface ZombieWaveMods { speed: number; hp: number; damage: number }
