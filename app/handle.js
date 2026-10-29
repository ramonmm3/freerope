// Crossrope AMP handle over Web Bluetooth. Same protocol as the Android app (ble/Protocol.kt).
// Works in Chrome on Android/desktop and, on iPhone, in Bluefy or Safari with a Web Bluetooth extension.

const SERVICE = '07eb19be-1e89-4ee5-99a4-1aa7d52dea6b';
const NOTIFY = '7f5dd3d5-5fb1-4876-a725-56b75626f931';
const WRITE = '8aab96c2-db98-4ae9-8f41-3896039c95a8';

/** Commands end with (sum(body) ^ 0xFF) & 0xFF. */
function frame(...body) {
  const sum = body.reduce((a, b) => a + b, 0);
  return new Uint8Array([...body, (sum ^ 0xff) & 0xff]);
}
const START = frame(0x50, 0x00);
const STOP = frame(0x50, 0x01);
const START_V2 = frame(0xb1, 0x00, 0x3c);

export const bluetoothAvailable = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);

export class Handle extends EventTarget {
  constructor() {
    super();
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.name = null;
    this.firmware = null;
    this.demo = false;
    this.device = null;
    this.writeChar = null;
    this.queue = [];
    this.writing = false;
    this.wantCounting = false;
    this.demoTimer = null;
    this.demoCount = 0;
  }

  set(state) {
    this.state = state;
    this.dispatchEvent(new Event('change'));
  }

  /** Must be called from a tap: the browser shows its device chooser. */
  async connect() {
    if (!bluetoothAvailable()) throw new Error('no-bluetooth');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Crossrope' }, { namePrefix: 'CROSSROPE' }, { services: [SERVICE] }],
      optionalServices: [SERVICE],
    });
    this.device = device;
    this.name = device.name || 'Crossrope AMP';
    device.addEventListener('gattserverdisconnected', () => this.onDropped());
    await this.open();
  }

  async open() {
    this.set('connecting');
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const server = await this.device.gatt.connect();
        const svc = await server.getPrimaryService(SERVICE);
        const notify = await svc.getCharacteristic(NOTIFY);
        this.writeChar = await svc.getCharacteristic(WRITE);
        notify.addEventListener('characteristicvaluechanged', (e) => this.onData(new Uint8Array(e.target.value.buffer)));
        await notify.startNotifications();
        this.set('connected');
        // The handle greets with its firmware version; START_V2 depends on it.
        await new Promise((r) => setTimeout(r, 600));
        if (this.wantCounting) this.startCounting();
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    this.set('disconnected');
    throw lastError;
  }

  async onDropped() {
    if (this.demo) return;
    this.set('disconnected');
    // Reconnect quietly during a workout; the handle needs START again afterwards.
    if (this.wantCounting && this.device) {
      try { await this.open(); } catch { /* user can reconnect from the banner */ }
    }
  }

  onData(d) {
    if (!d.length) return;
    if (d[0] === 0xac && d.length > 2) {
      this.dispatchEvent(new CustomEvent('count', { detail: (d[1] << 8) | d[2] }));
    } else if (d[0] === 0xb4) {
      const text = new TextDecoder().decode(d.slice(1, 6)).trim();
      const v = (text.match(/^[0-9.]+/) || [''])[0];
      if (v) {
        this.firmware = v;
        this.dispatchEvent(new Event('change'));
      }
    }
  }

  write(bytes) {
    this.queue.push(bytes);
    if (!this.writing) this.flush();
  }

  async flush() {
    this.writing = true;
    while (this.queue.length) {
      const bytes = this.queue.shift();
      try {
        if (this.writeChar?.writeValueWithoutResponse) await this.writeChar.writeValueWithoutResponse(bytes);
        else await this.writeChar?.writeValue(bytes);
      } catch { /* dropped; reconnect re-sends START */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    this.writing = false;
  }

  startCounting() {
    this.wantCounting = true;
    if (this.demo) return this.startDemoJumps();
    if (this.state !== 'connected') return;
    this.write(START);
    if (parseInt(this.firmware || '0', 10) >= 2) this.write(START_V2);
  }

  stopCounting() {
    this.wantCounting = false;
    if (this.demo) return this.stopDemoJumps();
    if (this.state === 'connected') this.write(STOP);
  }

  disconnect() {
    this.wantCounting = false;
    this.stopDemo();
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null;
    this.set('disconnected');
  }

  // ---------------------------------------------------------------- demo

  startDemo() {
    this.demo = true;
    this.name = 'Demo handle';
    this.firmware = '2.000';
    this.set('connected');
  }

  stopDemo() {
    if (!this.demo) return;
    this.stopDemoJumps();
    this.demo = false;
    this.name = null;
    this.firmware = null;
    this.set('disconnected');
  }

  startDemoJumps() {
    this.stopDemoJumps();
    this.demoCount = 0;
    const pace = 120 + Math.floor(Math.random() * 30);
    const tick = () => {
      this.demoCount++;
      this.dispatchEvent(new CustomEvent('count', { detail: this.demoCount }));
      let wait = 60000 / pace + (Math.random() * 100 - 50);
      if (Math.random() < 1 / 70) wait += 2000; // the occasional miss
      this.demoTimer = setTimeout(tick, wait);
    };
    this.demoTimer = setTimeout(tick, 400);
  }

  stopDemoJumps() {
    clearTimeout(this.demoTimer);
    this.demoTimer = null;
  }
}
