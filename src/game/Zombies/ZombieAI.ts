import type { Zombie, ZombieContext } from './Zombie';

/** IDLE → DETECT → CHASE → ATTACK → (TAKE_DAMAGE) → DEAD */
export enum ZState {
  Idle = 'IDLE',
  Detect = 'DETECT',
  Chase = 'CHASE',
  Attack = 'ATTACK',
  Hurt = 'TAKE_DAMAGE',
  Dead = 'DEAD',
}

const HURT_TIME = 0.28;

/**
 * Pure decision logic. It only sets the zombie's desired movement (moveX/moveZ/moveSpeed)
 * and facing; Zombie performs the actual Rapier movement and animation.
 */
export class ZombieAI {
  state = ZState.Idle;
  timer = 0;
  attackT = 0;
  private hitDone = false;
  private wanderT = 0;
  private aggro = false;
  private aggroIn = 10;
  private growlT = 2;

  constructor(private z: Zombie) {}

  reset() {
    this.state = ZState.Idle;
    this.timer = 0; this.attackT = 0; this.hitDone = false;
    this.wanderT = Math.random() * 2;
    this.aggro = false;
    this.aggroIn = 8 + Math.random() * 10; // idle zombies eventually notice the player
    this.growlT = 1 + Math.random() * 4;
  }

  /** Heard a gunshot / noise. */
  alert() { if (this.state === ZState.Idle) this.aggro = true; }

  onDamaged() {
    if (this.state === ZState.Dead) return;
    this.aggro = true;
    if (Math.random() >= this.z.stats.staggerResist) this.set(ZState.Hurt);
    else if (this.state === ZState.Idle || this.state === ZState.Detect) this.set(ZState.Chase);
  }

  onDeath() { this.state = ZState.Dead; }

  private set(s: ZState) {
    this.state = s;
    this.timer = 0;
    if (s === ZState.Attack) { this.attackT = 0; this.hitDone = false; }
  }

  update(dt: number, ctx: ZombieContext) {
    const z = this.z;
    const dx = ctx.playerPos.x - z.x;
    const dz = ctx.playerPos.z - z.z;
    const dist = Math.hypot(dx, dz);
    const tx = dist > 1e-4 ? dx / dist : 0;
    const tz = dist > 1e-4 ? dz / dist : 1;
    z.moveSpeed = 0;

    if (!ctx.playerAlive && this.state !== ZState.Idle && this.state !== ZState.Hurt) {
      this.aggro = false; this.aggroIn = 9999; this.set(ZState.Idle);
    }

    if (this.state === ZState.Idle || this.state === ZState.Chase) {
      this.growlT -= dt;
      if (this.growlT <= 0) { ctx.audio.zombieGrowl(z.center, z.type); this.growlT = 3 + Math.random() * 5; }
    }

    switch (this.state) {
      case ZState.Idle: {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 2 + Math.random() * 3;
          if (Math.random() < 0.5) { z.moveX = 0; z.moveZ = 0; }
          else { const a = Math.random() * Math.PI * 2; z.moveX = Math.cos(a); z.moveZ = Math.sin(a); }
        }
        if (z.moveX !== 0 || z.moveZ !== 0) {
          z.moveSpeed = z.speed * 0.25;
          z.faceX = z.moveX; z.faceZ = z.moveZ;
        }
        this.aggroIn -= dt;
        const r = z.stats.detectRadius * (ctx.playerSprinting ? 1.4 : 1);
        if (ctx.playerAlive && (dist < r || this.aggro || this.aggroIn <= 0)) {
          ctx.audio.zombieGrowl(z.center, z.type, true);
          this.set(ZState.Detect);
        }
        break;
      }
      case ZState.Detect: {
        z.faceX = tx; z.faceZ = tz;
        this.timer += dt;
        if (this.timer >= (z.type === 'runner' ? 0.35 : 0.7)) this.set(ZState.Chase);
        break;
      }
      case ZState.Chase: {
        z.moveX = tx; z.moveZ = tz; z.moveSpeed = z.speed;
        z.faceX = tx; z.faceZ = tz;
        if (dist <= z.stats.attackRange) this.set(ZState.Attack);
        break;
      }
      case ZState.Attack: {
        z.faceX = tx; z.faceZ = tz;
        this.attackT += dt;
        if (!this.hitDone && this.attackT >= z.stats.attackWindup) {
          this.hitDone = true;
          ctx.audio.zombieAttack(z.center);
          if (dist <= z.stats.attackRange * 1.4 && Math.abs(ctx.playerPos.y - z.y) < 2) {
            ctx.damagePlayer(z.damage, z.center);
          }
        }
        if (this.attackT >= z.stats.attackDuration) {
          if (dist <= z.stats.attackRange * 1.25) { this.attackT = 0; this.hitDone = false; }
          else this.set(ZState.Chase);
        }
        break;
      }
      case ZState.Hurt: {
        this.timer += dt;
        if (this.timer >= HURT_TIME) this.set(ctx.playerAlive ? ZState.Chase : ZState.Idle);
        break;
      }
      case ZState.Dead:
        break;
    }
  }
}
