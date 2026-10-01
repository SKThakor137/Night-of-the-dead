/** Central keyboard/mouse state. Only records input while `active` (game running + pointer locked). */
export class Input {
  active = false;
  private down = new Set<string>();
  private pressed = new Set<string>();
  private buttons = new Set<number>();
  private clicks = new Set<number>();
  private wheel = 0;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', this.onContext);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.down.delete(e.code); };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.active) return;
    this.buttons.add(e.button);
    this.clicks.add(e.button);
  };
  private onMouseUp = (e: MouseEvent) => { this.buttons.delete(e.button); };
  private onWheel = (e: WheelEvent) => { if (this.active) this.wheel += e.deltaY; };
  private onBlur = () => this.reset();
  private onContext = (e: Event) => { if (this.active) e.preventDefault(); };

  setActive(v: boolean) {
    this.active = v;
    if (!v) this.reset();
  }

  isDown(code: string) { return this.down.has(code); }
  mouseDown(button = 0) { return this.buttons.has(button); }
  consumePress(code: string) { return this.pressed.delete(code); }
  consumeClick(button = 0) { return this.clicks.delete(button); }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  reset() {
    this.down.clear(); this.pressed.clear(); this.buttons.clear(); this.clicks.clear(); this.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('contextmenu', this.onContext);
  }
}
