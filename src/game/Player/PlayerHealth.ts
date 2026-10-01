export class PlayerHealth {
  readonly max = 100;
  value = 100;
  dead = false;
  onDamage?: (amount: number) => void;
  onDeath?: () => void;

  damage(n: number) {
    if (this.dead || n <= 0) return;
    this.value = Math.max(0, this.value - n);
    this.onDamage?.(n);
    if (this.value <= 0) {
      this.dead = true;
      this.onDeath?.();
    }
  }

  heal(n: number) {
    if (this.dead) return;
    this.value = Math.min(this.max, this.value + n);
  }

  reset() {
    this.value = this.max;
    this.dead = false;
  }
}
