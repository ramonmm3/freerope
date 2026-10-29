// Injected by the iOS app before the page loads. WKWebView has no Web Bluetooth, so this provides
// the subset app/handle.js uses on top of CoreBluetooth (BluetoothBridge.swift), plus a screen wake lock.
(() => {
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ble;
  if (!native) return;
  window.FREEROPE_NATIVE = 'ios';

  const pending = new Map();
  let seq = 0;
  const call = (cmd, args = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    native.postMessage({ id, cmd, ...args });
  });
  const domError = ({ name, message }) => {
    try { return new DOMException(message, name); } catch { const e = new Error(message); e.name = name; return e; }
  };
  const bytesOf = (data) => (data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const devices = new Map();

  class Characteristic extends EventTarget {
    constructor(device, service, uuid) { super(); this._device = device; this.service = service; this.uuid = uuid; this.value = null; }
    async startNotifications() { await call('startNotifications', { device: this._device.id, char: this.uuid }); return this; }
    async writeValueWithoutResponse(data) { await call('write', { device: this._device.id, char: this.uuid, data: toB64(bytesOf(data)), withResponse: false }); }
    async writeValueWithResponse(data) { await call('write', { device: this._device.id, char: this.uuid, data: toB64(bytesOf(data)), withResponse: true }); }
    writeValue(data) { return this.writeValueWithResponse(data); }
  }

  class Service {
    constructor(device, uuid, chars) { this.device = device; this.uuid = uuid; this.isPrimary = true; this._chars = chars; }
    async getCharacteristic(uuid) {
      uuid = String(uuid).toLowerCase();
      if (!this._chars.includes(uuid)) throw domError({ name: 'NotFoundError', message: 'No characteristic ' + uuid });
      const cache = this.device._chars;
      if (!cache.has(uuid)) cache.set(uuid, new Characteristic(this.device, this, uuid));
      return cache.get(uuid);
    }
  }

  class Device extends EventTarget {
    constructor(id, name) {
      super();
      this.id = id;
      this.name = name;
      this._services = {};
      this._chars = new Map();
      const device = this;
      this.gatt = {
        device,
        connected: false,
        async connect() {
          const r = await call('connect', { device: device.id });
          device._services = r.services || {};
          device._chars = new Map(); // fresh objects per connection, like Web Bluetooth
          this.connected = true;
          return this;
        },
        disconnect() {
          if (!this.connected) return;
          this.connected = false;
          call('disconnect', { device: device.id }).catch(() => {});
        },
        async getPrimaryService(uuid) {
          uuid = String(uuid).toLowerCase();
          if (!this.connected || !device._services[uuid]) throw domError({ name: 'NotFoundError', message: 'No service ' + uuid });
          return new Service(device, uuid, device._services[uuid]);
        },
      };
    }
  }

  window.__ble = {
    reply(id, ok, value) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(value) : p.reject(domError(value || { name: 'NetworkError', message: 'Bluetooth error' }));
    },
    event(type, d) {
      const device = devices.get(d.device);
      if (!device) return;
      if (type === 'value') {
        const c = device._chars.get(d.char);
        if (!c) return;
        const bytes = fromB64(d.data);
        c.value = new DataView(bytes.buffer);
        c.dispatchEvent(new Event('characteristicvaluechanged'));
      } else if (type === 'disconnected') {
        const wasConnected = device.gatt.connected;
        device.gatt.connected = false;
        if (wasConnected) device.dispatchEvent(new Event('gattserverdisconnected'));
      }
    },
  };

  const bluetooth = {
    async getAvailability() { return true; },
    async requestDevice(options = {}) {
      const filters = options.filters || [];
      const r = await call('requestDevice', {
        namePrefixes: filters.map((f) => f.namePrefix || f.name).filter(Boolean),
        services: filters.flatMap((f) => f.services || []).map(String),
      });
      if (!devices.has(r.id)) devices.set(r.id, new Device(r.id, r.name));
      return devices.get(r.id);
    },
  };
  Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true });

  // Always native: WKWebView's own wake lock isn't reliable across iOS versions.
  {
    const wakeLock = {
      async request() {
        native.postMessage({ id: 0, cmd: 'keepAwake', on: true });
        const lock = new EventTarget();
        lock.type = 'screen';
        lock.released = false;
        lock.release = async () => {
          if (lock.released) return;
          lock.released = true;
          native.postMessage({ id: 0, cmd: 'keepAwake', on: false });
        };
        return lock;
      },
    };
    Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true });
  }
})();
