import { describe, expect, it } from 'vitest';
import {
  describeAdvertisement,
  parseControlMessage,
  parseFirmwareRevisionString,
  parseImageAckDiagnostics,
  parseManufacturerData,
  u32le,
} from '../shared/protocol';

describe('advertisement parsing', () => {
  const full = new Uint8Array([0x53, 0x50, 0x4c, 0x11, 0xbb, 0x01, 0x13]);
  it('parses the full manufacturer payload', () => {
    const a = parseManufacturerData(full, true)!;
    expect(a.manufacturerId).toBe(0x5053);
    expect(a.screenType).toBe(0x134c);
    expect(a.capabilityFlags).toBe(0x11);
    expect(a.firmwareRaw).toBe(0xbb);
    const d = describeAdvertisement(a);
    expect(d.isTodooCard).toBe(true);
    expect(d.secure).toBe(true);
    expect(d.pairingWindowOpen).toBe(false);
    expect(d.turboLink).toBe(true);
    expect(d.otaRecovery).toBe(false);
    expect(d.pairingHoldSeconds).toBe(5);
  });
  it('parses the Web Bluetooth form without the company id', () => {
    const a = parseManufacturerData(full.subarray(2), false)!;
    expect(a.screenType).toBe(0x134c);
    expect(describeAdvertisement({ ...a, capabilityFlags: 0x13 }).pairingWindowOpen).toBe(true);
  });
});

describe('firmware revision string', () => {
  it('parses hex and decimal forms', () => {
    expect(parseFirmwareRevisionString('0xBB')).toBe(187);
    expect(parseFirmwareRevisionString('0xa7')).toBe(167);
    expect(parseFirmwareRevisionString('v187')).toBe(187);
    expect(parseFirmwareRevisionString('187')).toBe(187);
    expect(parseFirmwareRevisionString('1.2.3')).toBeNull();
  });
});

describe('control messages', () => {
  it('parses block size, announce and acks', () => {
    expect(parseControlMessage(new Uint8Array([0x01, 0xf4, 0x00]))).toEqual({ kind: 'blockSize', ok: true, blockSize: 244 });
    expect(parseControlMessage(new Uint8Array([0x02, 0x00]))).toEqual({ kind: 'announce', ok: true });
    expect(parseControlMessage(new Uint8Array([0x05, 0x00, 0xe0, 0x00, 0x00, 0x00]))).toEqual({ kind: 'ack', status: 0, index: 224 });
    expect(parseControlMessage(new Uint8Array([0x05, 0x08, 0, 0, 0, 0]))).toEqual({ kind: 'ack', status: 8 });
    expect(parseControlMessage(new Uint8Array([0x05, 0x09]))).toEqual({ kind: 'ack', status: 9 });
    expect(parseControlMessage(new Uint8Array([0x77])).kind).toBe('unknown');
  });
  it('encodes little-endian u32', () => {
    expect(Array.from(u32le(180720))).toEqual([0xf0, 0xc1, 0x02, 0x00]);
  });
});

describe('diagnostics', () => {
  it('parses the 20-byte record', () => {
    const d = new Uint8Array(20);
    d[0] = 0x27;
    d[1] = 0x01;
    d[2] = 3;
    d[3] = 0x05;
    d.set([0x10, 0x00, 0x11, 0x00, 0x12, 0x00, 0x01, 0x00], 4);
    d.set([0x40, 0x01, 0x00, 0x00], 12);
    d[16] = 0x00;
    d[17] = 0x00;
    d.set([0x3f, 0x01], 18);
    const r = parseImageAckDiagnostics(d)!;
    expect(r.session).toBe(3);
    expect(r.generated).toBe(16);
    expect(r.rejected).toBe(1);
    expect(r.requestedBlock).toBe(320);
    expect(r.lastReceivedBlock).toBe(319);
  });
});
