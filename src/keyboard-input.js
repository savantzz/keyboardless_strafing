// Real keyboard A/D strafe-key capture, for the "keyboard mode" toggle
// that switches the sim from inferring a held key off the mouse
// (keyboardlessWishDir) to reading an actually-held key (keyWishDir) and
// enables the real strafe-key-vs-mouse timing metric (strafesync.js) --
// that metric needs an independent second signal to compare the mouse
// against, which a keyboardless setup doesn't have by construction.
//
// direction() only reports a held key while the pointer is locked, same
// as MouseInput only listening for mousemove while locked: otherwise a
// key held from before a mode switch, or held while typing in the
// settings panel, would silently keep steering the sim in the
// background.
export class KeyboardInput {
  constructor() {
    this.left = false;
    this.right = false;
    this.locked = false;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  attach() {
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  detach() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
  }

  setLocked(locked) {
    this.locked = locked;
    if (!locked) {
      // Release cleanly on unlock -- otherwise a key held at the moment
      // Esc is pressed (which the browser never delivers a keyup for,
      // since focus leaves the page) would stick "held" forever.
      this.left = false;
      this.right = false;
    }
  }

  _onKeyDown(e) {
    if (e.code === 'KeyA') this.left = true;
    else if (e.code === 'KeyD') this.right = true;
  }

  _onKeyUp(e) {
    if (e.code === 'KeyA') this.left = false;
    else if (e.code === 'KeyD') this.right = false;
  }

  // +1 = right (D) held, -1 = left (A) held, 0 = neither or both (matches
  // the reference: holding both cancels out, treated as transient/none).
  direction() {
    if (!this.locked) return 0;
    if (this.left === this.right) return 0;
    return this.right ? 1 : -1;
  }
}
