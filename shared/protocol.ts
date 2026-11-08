/**
 * TodooCard / T3 protocol constants and pure helpers.
 *
 * Written from observed behaviour of the device and the publicly documented
 * workflow of the vendor's "TodooCard Skills" macOS tooling. No vendor code is
 * included here.
 */

export const PANEL_WIDTH = 528;
export const PANEL_HEIGHT = 792;
export const PANEL_PIXELS = PANEL_WIDTH * PANEL_HEIGHT;
/** Two pixels per byte, high nibble first. */
export const CONTROLLER_BYTES = PANEL_PIXELS / 2; // 209088

export const MANUFACTURER_ID = 0x5053;
export const SCREEN_TYPE_T3 = 0x134c;

/** 16-bit UUIDs expanded by the Web Bluetooth helpers. */
export const UUIDS = {
  imageService: 0xfef0,
  imageServiceAlt: 0xfdf0,
  control: 0xfef1,
  controlAlt: 0xfdf1,
  data: 0xfef2,
  dataAlt: 0xfdf2,
  batteryService: 0x180f,
  batteryLevel: 0x2a19,
  deviceInfoService: 0x180a,
  modelNumber: 0x2a24,
  serialNumber: 0x2a25,
  firmwareRevision: 0x2a26,
  hardwareRevision: 0x2a27,
  manufacturerName: 0x2a29,
  diagnosticsService: 'd8b282f0-0f9b-4a7a-b5e8-8e6e5a3c1001',
  /** Undocumented 22-byte status record; captured raw so counters can be decoded over time. */
  diagnosticsStatus: 'd8b282f0-0f9b-4a7a-b5e8-8e6e5a3c1002',
  diagnosticsImageAck: 'd8b282f0-0f9b-4a7a-b5e8-8e6e5a3c1003',
} as const;

/** Firmware thresholds (raw firmware byte). */
export const FW = {
  secureMinimum: 0x8c, // encrypted GATT when capability bit 0x01 is set
  pairingHoldFiveSeconds: 0x98, // v152: 5 s hold, older needs 10 s
  verifiedTransfer: 0x9d, // v157: 2 KB blocks, 32-block windows with checkpoints
  diagnostics: 0xa5, // v165: retained image-ACK diagnostics
  progressLease: 0xa6, // v166: 10 s valid-progress lease, may reboot after stall
} as const;

export const CAPABILITY = {
  encryptedGatt: 0x01,
  pairingWindowOpen: 0x02,
  otaRecovery: 0x08,
  turboLink: 0x10,
} as const;

/** Control commands written to FEF1. */
export const CMD = {
  requestBlockSize: 0x01,
  announcePayload: 0x02,
  startTransfer: 0x03,
  dataAck: 0x05,
} as const;

export const STATUS = {
  success: 0x00,
  malformedBlock: 0x01,
  transferEnd: 0x08,
  flashWriteFailed: 0x09,
  flashVerifyFailed: 0x0a,
} as const;

/** Payload flags for the announce (0x02) command. */
export const PAYLOAD_FLAGS = {
  compressed: 0x01,
  raw: 0x03,
  allowDeviceButton: 0x10,
} as const;

export const VERIFIED_WINDOW_BLOCKS = 32;
export const CHECKPOINT_TIMEOUT_MS = 5000;
export const FINAL_ACK_TIMEOUT_MS = 10000;
export const LEGACY_FINAL_ACK_TIMEOUT_MS = 90000;
export const MAX_REPAIR_REQUESTS = 16;
export const CONTROL_RESPONSE_TIMEOUT_MS = 5000;

export interface Advertisement {
  manufacturerId: number;
  screenType: number;
  capabilityFlags: number;
  firmwareRaw: number;
}

/**
 * Parse the TodooCard manufacturer-specific payload *after* the 2-byte company
 * identifier has been stripped (that is how Web Bluetooth delivers it) or the
 * full payload including the identifier.
 */
export function parseManufacturerData(bytes: Uint8Array, includesCompanyId: boolean): Advertisement | null {
  const d = includesCompanyId ? bytes : concat(new Uint8Array([MANUFACTURER_ID & 0xff, MANUFACTURER_ID >> 8]), bytes);
  if (d.length < 7) return null;
  return {
    manufacturerId: d[0] | (d[1] << 8),
    screenType: d[2] | (d[6] << 8),
    capabilityFlags: d[3],
    firmwareRaw: d[4],
  };
}

export function describeAdvertisement(a: Advertisement) {
  const secure = a.screenType === SCREEN_TYPE_T3 && a.firmwareRaw >= FW.secureMinimum && (a.capabilityFlags & CAPABILITY.encryptedGatt) !== 0;
  return {
    isTodooCard: a.manufacturerId === MANUFACTURER_ID && a.screenType === SCREEN_TYPE_T3,
    secure,
    pairingWindowOpen: secure && (a.capabilityFlags & CAPABILITY.pairingWindowOpen) !== 0,
    otaRecovery: (a.capabilityFlags & CAPABILITY.otaRecovery) !== 0,
    turboLink: (a.capabilityFlags & CAPABILITY.turboLink) !== 0,
    firmwareVersion: a.firmwareRaw,
    pairingHoldSeconds: a.firmwareRaw >= FW.pairingHoldFiveSeconds ? 5 : 10,
  };
}

/**
 * The Device Information "Firmware Revision String" on T3 reads like "0xBB".
 * Returns the raw firmware byte or null when unparseable.
 */
export function parseFirmwareRevisionString(s: string): number | null {
  const t = s.trim();
  const hex = /^0x([0-9a-f]{1,2})$/i.exec(t);
  if (hex) return parseInt(hex[1], 16);
  const dec = /^v?(\d{1,3})$/i.exec(t);
  if (dec) {
    const n = parseInt(dec[1], 10);
    return n >= 0 && n <= 255 ? n : null;
  }
  return null;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

export function readU32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export type ControlMessage =
  | { kind: 'blockSize'; ok: boolean; blockSize: number }
  | { kind: 'announce'; ok: boolean }
  | { kind: 'ack'; status: number; index?: number }
  | { kind: 'unknown'; bytes: Uint8Array };

export function parseControlMessage(bytes: Uint8Array): ControlMessage {
  const cmd = bytes[0];
  if (cmd === CMD.requestBlockSize && bytes.length >= 3) {
    return { kind: 'blockSize', ok: bytes[2] === STATUS.success, blockSize: bytes[1] };
  }
  if (cmd === CMD.announcePayload && bytes.length >= 2) {
    return { kind: 'announce', ok: bytes[1] === STATUS.success };
  }
  if (cmd === CMD.dataAck && bytes.length >= 2) {
    const status = bytes[1];
    if (status === STATUS.success && bytes.length >= 6) {
      return { kind: 'ack', status, index: readU32le(bytes, 2) };
    }
    return { kind: 'ack', status };
  }
  return { kind: 'unknown', bytes };
}

export function describeAckStatus(status: number): string {
  switch (status) {
    case STATUS.malformedBlock:
      return 'Device rejected a malformed or out-of-order image block (status 0x01)';
    case STATUS.flashWriteFailed:
      return 'External Flash write failed on the device (status 0x09)';
    case STATUS.flashVerifyFailed:
      return 'External Flash readback verification failed on the device (status 0x0A)';
    default:
      return `Device interrupted image transfer with status 0x${status.toString(16).padStart(2, '0')}`;
  }
}

export interface ImageAckDiagnostics {
  session: number;
  flags: number;
  generated: number;
  attempts: number;
  accepted: number;
  rejected: number;
  requestedBlock: number;
  previousStatus: number;
  lastNotifyResult: number;
  lastReceivedBlock: number;
}

export function parseImageAckDiagnostics(d: Uint8Array): ImageAckDiagnostics | null {
  if (d.length < 20 || d[0] !== 0x27 || d[1] !== 0x01) return null;
  const u16 = (o: number) => d[o] | (d[o + 1] << 8);
  return {
    session: d[2],
    flags: d[3],
    generated: u16(4),
    attempts: u16(6),
    accepted: u16(8),
    rejected: u16(10),
    requestedBlock: readU32le(d, 12),
    previousStatus: d[16],
    lastNotifyResult: d[17],
    lastReceivedBlock: u16(18),
  };
}
