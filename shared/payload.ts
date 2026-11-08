/**
 * Transfer payload builders.
 *
 * v157+ firmware accepts the raw controller bitmap (announce flags 0x03) or a
 * QuickLZ stream (flags 0x01). This project sends the raw bitmap, which avoids
 * shipping a QuickLZ encoder (QuickLZ is GPL licensed) at the cost of roughly
 * 15% more bytes on the wire.
 *
 * Firmware before v157 only accepts the QuickLZ *container* with 64-byte stored
 * blocks. A stored block is not compression: a 3-byte header followed by the
 * literal bytes, so it is implemented here.
 */
import { CONTROLLER_BYTES, FW } from './protocol.js';

export type TransferProfile = 'raw' | 'legacy-stored';

export interface PreparedPayload {
  profile: TransferProfile;
  bytes: Uint8Array;
  /** Whether the device expects windowed transfer with Flash checkpoints (v157+). */
  verifiedWindows: boolean;
}

export const LEGACY_BLOCK = 64;
/** QuickLZ header byte for a stored (uncompressed) level-1 block with a 3-byte header. */
const LEGACY_HEADER = 0x74;

export function buildLegacyStoredStream(controller: Uint8Array): Uint8Array {
  if (controller.length % LEGACY_BLOCK !== 0) throw new Error('controller bitmap must be a multiple of 64 bytes');
  const blocks = controller.length / LEGACY_BLOCK;
  const out = new Uint8Array(4 + blocks * (3 + LEGACY_BLOCK));
  let o = 4; // four zero bytes prefix
  for (let b = 0; b < blocks; b++) {
    out[o++] = LEGACY_HEADER;
    out[o++] = 3 + LEGACY_BLOCK; // compressed size incl. header
    out[o++] = LEGACY_BLOCK; // decoded size
    out.set(controller.subarray(b * LEGACY_BLOCK, (b + 1) * LEGACY_BLOCK), o);
    o += LEGACY_BLOCK;
  }
  return out;
}

export function selectPayload(controller: Uint8Array, firmwareRaw: number): PreparedPayload {
  if (controller.length !== CONTROLLER_BYTES) throw new Error(`controller bitmap must be ${CONTROLLER_BYTES} bytes`);
  if (firmwareRaw >= FW.verifiedTransfer) {
    return { profile: 'raw', bytes: controller, verifiedWindows: true };
  }
  return { profile: 'legacy-stored', bytes: buildLegacyStoredStream(controller), verifiedWindows: false };
}

/** Pads a payload so that it is a whole number of blocks (only needed for QuickLZ streams). */
export function padToBlocks(bytes: Uint8Array, blockPayloadSize: number): Uint8Array {
  const rem = bytes.length % blockPayloadSize;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (blockPayloadSize - rem));
  out.set(bytes);
  return out;
}
