/**
 * Web Bluetooth client for TodooCard / T3 cards.
 *
 * Pairing model: the card requires an encrypted link for the Battery Level
 * characteristic. Reading it makes the browser/OS create the bond (the OS may
 * show a pairing prompt). The card only accepts a *new* bond while its physical
 * pairing window is open (hold the hidden rear button ~5 s until the front
 * light flashes; the window closes after 60 s). An existing bond works at any
 * time. A card that refuses drops the connection within about a second.
 */
import {
  CAPABILITY,
  FW,
  UUIDS,
  describeAdvertisement,
  parseFirmwareRevisionString,
  parseImageAckDiagnostics,
  parseManufacturerData,
  type Advertisement,
  type ImageAckDiagnostics,
} from '@shared/protocol';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
}

export interface DeviceInfo {
  name: string;
  id: string;
  model?: string;
  serial?: string;
  firmwareString?: string;
  firmwareRaw?: number;
  hardware?: string;
  manufacturer?: string;
  battery?: number;
  /** True once an encrypted characteristic has been read successfully in this session. */
  bonded: boolean;
  advertisement?: Advertisement;
  flags?: ReturnType<typeof describeAdvertisement>;
  rssi?: number;
  diagnostics?: ImageAckDiagnostics;
  services?: string[];
}

export class BleError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'BleError';
  }
}

const OPTIONAL_SERVICES: BluetoothServiceUUID[] = [
  UUIDS.imageService,
  UUIDS.imageServiceAlt,
  UUIDS.batteryService,
  UUIDS.deviceInfoService,
  UUIDS.diagnosticsService,
];

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && typeof navigator.bluetooth?.requestDevice === 'function';
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new BleError(message, 'timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TodooCardClient extends EventTarget {
  device: BluetoothDevice | null = null;
  server: BluetoothRemoteGATTServer | null = null;
  control: BluetoothRemoteGATTCharacteristic | null = null;
  data: BluetoothRemoteGATTCharacteristic | null = null;
  info: DeviceInfo | null = null;
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  private advertisementAbort: AbortController | null = null;

  log(level: LogLevel, msg: string) {
    this.dispatchEvent(new CustomEvent<LogEntry>('log', { detail: { t: Date.now(), level, msg } }));
  }

  private emitInfo() {
    this.dispatchEvent(new CustomEvent<DeviceInfo | null>('info', { detail: this.info }));
  }

  /** Serialise GATT operations: Chrome rejects concurrent operations on one device. */
  op<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get connected(): boolean {
    return !!this.server?.connected;
  }

  /** Show the browser's device chooser filtered to TodooCard advertisements. */
  async requestDevice(): Promise<BluetoothDevice> {
    if (!isWebBluetoothSupported()) {
      throw new BleError('Web Bluetooth is not available. Use Chrome or Edge on a secure (https) page.', 'unsupported');
    }
    const filters: BluetoothLEScanFilter[] = [
      { manufacturerData: [{ companyIdentifier: 0x5053 }] },
      { namePrefix: 'TodooCard' },
      { services: [UUIDS.imageService] },
    ];
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices: OPTIONAL_SERVICES,
        optionalManufacturerData: [0x5053],
      } as RequestDeviceOptions);
    } catch (e) {
      if ((e as DOMException)?.name === 'NotFoundError') {
        throw new BleError('No device selected.', 'cancelled', e);
      }
      throw new BleError(`Device chooser failed: ${(e as Error).message}`, 'chooser', e);
    }
    this.attach(device);
    return device;
  }

  attach(device: BluetoothDevice) {
    if (this.device && this.device !== device) this.disconnect();
    this.device = device;
    this.info = { name: device.name ?? 'TodooCard', id: device.id, bonded: false };
    device.addEventListener('gattserverdisconnected', () => {
      this.log('warn', 'Disconnected');
      this.control = null;
      this.data = null;
      this.dispatchEvent(new Event('disconnected'));
    });
    this.emitInfo();
    this.startAdvertisementWatch().catch(() => undefined);
  }

  /** Advertisement watching is behind a flag in most Chrome builds; use it when present. */
  private async startAdvertisementWatch() {
    const dev = this.device as BluetoothDevice & { watchAdvertisements?: (o?: { signal?: AbortSignal }) => Promise<void> };
    if (!dev || typeof dev.watchAdvertisements !== 'function') return;
    this.advertisementAbort?.abort();
    const ac = new AbortController();
    this.advertisementAbort = ac;
    dev.addEventListener('advertisementreceived', (ev: Event) => {
      const e = ev as BluetoothAdvertisingEvent;
      const md = e.manufacturerData?.get(0x5053);
      if (!md || !this.info) return;
      const adv = parseManufacturerData(new Uint8Array(md.buffer, md.byteOffset, md.byteLength), false);
      if (!adv) return;
      this.info.advertisement = adv;
      this.info.flags = describeAdvertisement(adv);
      this.info.firmwareRaw = adv.firmwareRaw;
      this.info.rssi = e.rssi ?? undefined;
      this.emitInfo();
    });
    try {
      await dev.watchAdvertisements({ signal: ac.signal });
      this.log('debug', 'Watching advertisements');
    } catch {
      /* not supported */
    }
  }

  async connect(): Promise<void> {
    if (!this.device) throw new BleError('No device selected', 'nodevice');
    if (this.server?.connected) return;
    const gatt = this.device.gatt;
    if (!gatt) throw new BleError('Device has no GATT server', 'nogatt');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.log('info', `Connecting (attempt ${attempt}/3) ...`);
        this.server = await withTimeout(gatt.connect(), 15000, 'Timed out connecting');
        this.log('info', 'Connected');
        return;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        this.log('warn', `Connect failed: ${msg}`);
        if (attempt === 3) {
          const hint = /Unsupported device/i.test(msg)
            ? ' Chrome could not open a GATT connection. Make sure the card is not connected to another app, wait a few seconds (the card reboots after a refresh) and try again.'
            : '';
          throw new BleError(`Could not connect: ${msg}.${hint}`, 'connect', e);
        }
        await sleep(attempt === 1 ? 750 : 1500);
      }
    }
  }

  disconnect() {
    this.advertisementAbort?.abort();
    this.advertisementAbort = null;
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
    this.server = null;
    this.control = null;
    this.data = null;
  }

  private async readString(service: BluetoothRemoteGATTService, uuid: BluetoothCharacteristicUUID): Promise<string | undefined> {
    try {
      const ch = await service.getCharacteristic(uuid);
      const v = await this.op(() => ch.readValue());
      return new TextDecoder().decode(v).replace(/\0+$/, '');
    } catch {
      return undefined;
    }
  }

  /**
   * Read the encrypted Battery Level. This is the pairing proof: success means
   * the OS bond exists (or was just created). Failure usually means the card
   * refused a new bond because its pairing window is closed.
   */
  async verifyBond(): Promise<number> {
    if (!this.server?.connected) await this.connect();
    const server = this.server!;
    try {
      const svc = await withTimeout(server.getPrimaryService(UUIDS.batteryService), 10000, 'Battery service discovery timed out');
      const ch = await svc.getCharacteristic(UUIDS.batteryLevel);
      this.log('info', 'Reading encrypted Battery Level to verify/create the system bond ...');
      const v = await withTimeout(this.op(() => ch.readValue()), 30000, 'Encrypted read timed out (did you accept the pairing prompt?)');
      const battery = v.getUint8(0);
      if (this.info) {
        this.info.battery = battery;
        this.info.bonded = true;
        this.emitInfo();
      }
      this.log('info', `Encrypted link verified; battery=${battery}%`);
      return battery;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (!this.server?.connected || /disconnected|GATT Server is disconnected|Network/i.test(msg)) {
        throw new BleError(
          'The card dropped the link during the encrypted read. It is not bonded to this computer: hold the hidden button on the back for 5 seconds until the front light flashes, then connect again within 60 seconds.',
          'notbonded',
          e,
        );
      }
      if (/not allowed|Authentication|insufficient|GATT Error/i.test(msg)) {
        throw new BleError(`Encrypted read refused: ${msg}. Open the pairing window (hold the hidden rear button ~5 s) and retry.`, 'auth', e);
      }
      throw new BleError(msg, 'read', e);
    }
  }

  /** Read Device Information strings. Fills firmwareRaw from the revision string. */
  async readDeviceInfo(): Promise<DeviceInfo> {
    if (!this.server?.connected) await this.connect();
    const server = this.server!;
    const info = this.info ?? { name: this.device?.name ?? 'TodooCard', id: this.device?.id ?? '', bonded: false };
    try {
      const services = await server.getPrimaryServices();
      info.services = services.map((s) => s.uuid);
    } catch {
      /* ignore */
    }
    try {
      const dis = await withTimeout(server.getPrimaryService(UUIDS.deviceInfoService), 10000, 'Device Information discovery timed out');
      info.model = await this.readString(dis, UUIDS.modelNumber);
      info.serial = await this.readString(dis, UUIDS.serialNumber);
      info.firmwareString = await this.readString(dis, UUIDS.firmwareRevision);
      info.hardware = await this.readString(dis, UUIDS.hardwareRevision);
      info.manufacturer = await this.readString(dis, UUIDS.manufacturerName);
      if (info.firmwareString) {
        const raw = parseFirmwareRevisionString(info.firmwareString);
        if (raw !== null) info.firmwareRaw = raw;
      }
    } catch (e) {
      this.log('warn', `Device Information unavailable: ${(e as Error).message}`);
    }
    this.info = info;
    this.emitInfo();
    return info;
  }

  async readDiagnostics(): Promise<ImageAckDiagnostics | null> {
    if (!this.server?.connected) return null;
    try {
      const svc = await this.server.getPrimaryService(UUIDS.diagnosticsService);
      const ch = await svc.getCharacteristic(UUIDS.diagnosticsImageAck);
      const v = await this.op(() => ch.readValue());
      const diag = parseImageAckDiagnostics(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      if (diag && this.info) {
        this.info.diagnostics = diag;
        this.emitInfo();
      }
      return diag;
    } catch (e) {
      this.log('debug', `Diagnostics unavailable: ${(e as Error).message}`);
      return null;
    }
  }

  /** Locate the image-transfer control/data characteristics. */
  async prepareTransferCharacteristics(): Promise<{ control: BluetoothRemoteGATTCharacteristic; data: BluetoothRemoteGATTCharacteristic }> {
    if (!this.server?.connected) await this.connect();
    const server = this.server!;
    let svc: BluetoothRemoteGATTService;
    try {
      svc = await withTimeout(server.getPrimaryService(UUIDS.imageService), 10000, 'Image service discovery timed out');
    } catch {
      svc = await withTimeout(server.getPrimaryService(UUIDS.imageServiceAlt), 10000, 'Image service (FDF0) discovery timed out');
    }
    const [control, data] = await Promise.all([
      svc.getCharacteristic(svc.uuid.startsWith('0000fdf0') ? UUIDS.controlAlt : UUIDS.control),
      svc.getCharacteristic(svc.uuid.startsWith('0000fdf0') ? UUIDS.dataAlt : UUIDS.data),
    ]);
    this.control = control;
    this.data = data;
    return { control, data };
  }

  /**
   * Full connect sequence used by the UI: connect, verify bond (pairing proof),
   * then read device information and diagnostics when supported.
   */
  async connectAndIdentify(): Promise<DeviceInfo> {
    this.busy = true;
    try {
      await this.connect();
      await this.verifyBond();
      // The card may issue Service Changed after encryption; give the cache a moment.
      await sleep(600);
      const info = await this.readDeviceInfo();
      if ((info.firmwareRaw ?? 0) >= FW.diagnostics) await this.readDiagnostics();
      return info;
    } finally {
      this.busy = false;
    }
  }

  get requiresEncryptedGatt(): boolean {
    const f = this.info?.flags;
    if (f) return f.secure;
    // Without advertisement data assume current secure firmware.
    return (this.info?.firmwareRaw ?? 0xff) >= FW.secureMinimum;
  }

  get pairingWindowOpen(): boolean | undefined {
    const a = this.info?.advertisement;
    return a ? (a.capabilityFlags & CAPABILITY.pairingWindowOpen) !== 0 : undefined;
  }
}
