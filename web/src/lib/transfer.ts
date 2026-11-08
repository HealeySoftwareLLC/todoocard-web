/**
 * Image transfer state machine (port of the verified-window protocol).
 *
 * Sequence on the control characteristic (FEF1, notifications on):
 *   -> 01                      <- 01 <blockSize> 00
 *   -> 02 <len:u32le> <flags>  <- 02 00
 *   -> 03                      <- 05 00 <index:u32le>   (device asks for a block index)
 * Data blocks on FEF2: <index:u32le> + up to (blockSize-4) payload bytes.
 *
 * v157+ ("verified windows"): send at most 32 blocks, finishing the window
 * with a write-with-response, then wait for the device's durable Flash
 * checkpoint (05 00 <next index>). A lower index is a repair request. The
 * transfer is complete only after 05 08.
 */
import {
  CHECKPOINT_TIMEOUT_MS,
  CMD,
  CONTROL_RESPONSE_TIMEOUT_MS,
  FINAL_ACK_TIMEOUT_MS,
  FW,
  LEGACY_FINAL_ACK_TIMEOUT_MS,
  MAX_REPAIR_REQUESTS,
  PAYLOAD_FLAGS,
  STATUS,
  VERIFIED_WINDOW_BLOCKS,
  concat,
  describeAckStatus,
  hex,
  parseControlMessage,
  u32le,
  type ControlMessage,
} from '@shared/protocol';
import { padToBlocks, type PreparedPayload } from '@shared/payload';
import { BleError, type TodooCardClient } from './ble';

export interface TransferProgress {
  percent: number;
  blockIndex: number;
  totalBlocks: number;
  bytesSent: number;
  totalBytes: number;
  phase: 'handshake' | 'sending' | 'checkpoint' | 'refresh' | 'done' | 'failed';
}

export interface TransferOptions {
  payload: PreparedPayload;
  firmwareRaw: number;
  allowDeviceButton?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: TransferProgress) => void;
}

export interface TransferResult {
  ok: true;
  blocks: number;
  bytes: number;
  durationMs: number;
}

class ControlChannel {
  private queue: ControlMessage[] = [];
  private waiters: Array<{ resolve: (m: ControlMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private closed: Error | null = null;

  push(m: ControlMessage) {
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(m);
    } else this.queue.push(m);
  }

  close(err: Error) {
    this.closed = err;
    for (const w of this.waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  poll(): ControlMessage | undefined {
    return this.queue.shift();
  }

  next(timeoutMs: number, what: string): Promise<ControlMessage> {
    const m = this.queue.shift();
    if (m) return Promise.resolve(m);
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new BleError(`Timed out waiting for ${what}`, 'timeout'));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Copy into a standalone ArrayBuffer: Web Bluetooth's BufferSource typing rejects views over ArrayBufferLike. */
const toBuf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export async function runTransfer(client: TodooCardClient, opts: TransferOptions): Promise<TransferResult> {
  const started = Date.now();
  const log = (level: 'info' | 'warn' | 'error' | 'debug', msg: string) => client.log(level, msg);
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new BleError('Transfer cancelled', 'aborted');
  };

  if (client.busy) throw new BleError('Another operation is in progress', 'busy');
  client.busy = true;
  const channel = new ControlChannel();
  let control: BluetoothRemoteGATTCharacteristic;
  let data: BluetoothRemoteGATTCharacteristic;
  const onDisconnect = () => channel.close(new BleError('Device disconnected during transfer', 'disconnected'));
  client.addEventListener('disconnected', onDisconnect);

  try {
    ({ control, data } = await client.prepareTransferCharacteristics());
    const onNotify = (ev: Event) => {
      const v = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      log('debug', `Control <- ${hex(bytes)}`);
      channel.push(parseControlMessage(bytes));
    };
    control.addEventListener('characteristicvaluechanged', onNotify);
    await client.op(() => control.startNotifications());
    log('debug', 'Control notifications enabled; settling 400 ms');
    await sleep(400);

    const canWriteNoResp = control.properties.writeWithoutResponse;
    const canWriteResp = control.properties.write;
    const writeControl = async (bytes: Uint8Array) => {
      log('debug', `Control -> ${hex(bytes)}`);
      if (canWriteResp) await client.op(() => control.writeValueWithResponse(toBuf(bytes)));
      else await client.op(() => control.writeValueWithoutResponse(toBuf(bytes)));
    };
    const controlRoundTrip = async (bytes: Uint8Array, what: string): Promise<ControlMessage> => {
      await writeControl(bytes);
      try {
        return await channel.next(CONTROL_RESPONSE_TIMEOUT_MS, what);
      } catch (e) {
        if ((e as BleError).code === 'timeout' && canWriteNoResp && canWriteResp) {
          log('warn', `${what}: no reply; retrying the command without response`);
          await client.op(() => control.writeValueWithoutResponse(toBuf(bytes)));
          return channel.next(CONTROL_RESPONSE_TIMEOUT_MS, what);
        }
        throw e;
      }
    };

    const progress = (phase: TransferProgress['phase'], blockIndex: number, totalBlocks: number, blockPayloadSize: number, totalBytes: number) => {
      const bytesSent = Math.min(totalBytes, Math.max(0, blockIndex + 1) * blockPayloadSize);
      opts.onProgress?.({
        phase,
        blockIndex,
        totalBlocks,
        bytesSent,
        totalBytes,
        percent: totalBytes ? Math.min(100, Math.round((bytesSent / totalBytes) * 100)) : 0,
      });
    };

    // 1. Block size
    progress('handshake', -1, 0, 1, opts.payload.bytes.length);
    const bs = await controlRoundTrip(new Uint8Array([CMD.requestBlockSize]), 'block size reply');
    if (bs.kind !== 'blockSize' || !bs.ok) throw new BleError('Block size request was rejected', 'protocol');
    const blockPayloadSize = bs.blockSize - 4;
    if (blockPayloadSize <= 0) throw new BleError(`Device returned an invalid block size: ${bs.blockSize}`, 'protocol');
    log('info', `Block payload size: ${blockPayloadSize} bytes`);

    // 2. Announce payload
    const isCompressedContainer = opts.payload.profile === 'legacy-stored';
    let payload = opts.payload.bytes;
    if (isCompressedContainer) {
      const before = payload.length;
      payload = padToBlocks(payload, blockPayloadSize);
      if (payload.length !== before) log('info', `Payload padded by ${payload.length - before} bytes to ${payload.length}`);
    }
    let flags = isCompressedContainer ? PAYLOAD_FLAGS.compressed : PAYLOAD_FLAGS.raw;
    if (opts.allowDeviceButton) flags |= PAYLOAD_FLAGS.allowDeviceButton;
    const totalBlocks = Math.ceil(payload.length / blockPayloadSize);
    const ann = await controlRoundTrip(concat(new Uint8Array([CMD.announcePayload]), u32le(payload.length), new Uint8Array([flags])), 'payload announce reply');
    if (ann.kind !== 'announce' || !ann.ok) throw new BleError('Payload length was rejected by the device', 'protocol');
    log('info', `Announced ${payload.length} bytes (${totalBlocks} blocks, flags 0x${flags.toString(16).padStart(2, '0')})`);

    // 3. Start
    await writeControl(new Uint8Array([CMD.startTransfer]));

    const makeBlock = (index: number): Uint8Array => {
      const offset = index * blockPayloadSize;
      const len = Math.min(blockPayloadSize, payload.length - offset);
      return concat(u32le(index), payload.subarray(offset, offset + len));
    };
    const dataNoResp = data.properties.writeWithoutResponse;
    const dataResp = data.properties.write;
    if (!dataNoResp && !dataResp) throw new BleError('Data characteristic supports neither write mode', 'protocol');
    const writeBlock = async (index: number, withResponse: boolean) => {
      const block = makeBlock(index);
      if (withResponse && dataResp) await client.op(() => data.writeValueWithResponse(toBuf(block)));
      else if (dataNoResp) await client.op(() => data.writeValueWithoutResponse(toBuf(block)));
      else await client.op(() => data.writeValueWithResponse(toBuf(block)));
    };

    const expectAck = async (timeoutMs: number, what: string): Promise<{ index?: number; end: boolean }> => {
      for (;;) {
        const m = await channel.next(timeoutMs, what);
        if (m.kind !== 'ack') {
          log('debug', `Ignoring unexpected control message during transfer: ${m.kind}`);
          continue;
        }
        if (m.status === STATUS.transferEnd) return { end: true };
        if (m.status !== STATUS.success) throw new BleError(describeAckStatus(m.status), 'device');
        if (m.index === undefined) throw new BleError('Device returned a malformed data acknowledgement', 'protocol');
        return { index: m.index, end: false };
      }
    };

    if (opts.payload.verifiedWindows && opts.firmwareRaw >= FW.verifiedTransfer) {
      // ---- Verified windows (v157+) ----
      let repairs = 0;
      let lastSent = -1;
      let windowEnd = 0;
      let ended = false;
      const first = await expectAck(CONTROL_RESPONSE_TIMEOUT_MS * 2, 'initial block request');
      let index = first.end ? totalBlocks : first.index!;
      if (first.end) ended = true;
      else log('info', `Device requested initial block ${index}`);
      outer: while (!ended) {
        throwIfAborted();
        if (index > totalBlocks) throw new BleError(`Device returned invalid resume block ${index} (total ${totalBlocks})`, 'protocol');
        if (index === totalBlocks) {
          if (lastSent < totalBlocks - 1) throw new BleError(`Device skipped past payload data at block ${index}`, 'protocol');
          log('info', `Device checkpoint covers all ${totalBlocks} blocks; waiting for refresh acknowledgement`);
          progress('refresh', totalBlocks - 1, totalBlocks, blockPayloadSize, payload.length);
          const fin = await expectAck(FINAL_ACK_TIMEOUT_MS, 'the 0x05/0x08 refresh acknowledgement');
          if (fin.end) {
            ended = true;
            break;
          }
          index = fin.index!;
          continue;
        }
        if (lastSent >= 0) {
          if (index > windowEnd) throw new BleError(`Device checkpoint skipped from window end ${windowEnd} to block ${index}`, 'protocol');
          if (index < windowEnd) {
            repairs++;
            if (repairs > MAX_REPAIR_REQUESTS) throw new BleError(`Device requested too many block repairs (${repairs}); move the card closer and retry`, 'link');
            log('warn', `Device verified only through block ${index}; repairing the unfinished window (${repairs}/${MAX_REPAIR_REQUESTS})`);
          } else {
            repairs = 0;
            log('debug', `Durable Flash checkpoint accepted through block ${index}`);
          }
        }
        const windowStart = index;
        windowEnd = Math.min((Math.floor(index / VERIFIED_WINDOW_BLOCKS) + 1) * VERIFIED_WINDOW_BLOCKS, totalBlocks);
        log('debug', `Window [${windowStart}, ${windowEnd}) of ${totalBlocks}`);
        for (let i = windowStart; i < windowEnd; i++) {
          throwIfAborted();
          const barrier = i + 1 >= windowEnd;
          await writeBlock(i, barrier);
          lastSent = Math.max(lastSent, i);
          progress('sending', i, totalBlocks, blockPayloadSize, payload.length);
        }
        const isFinal = windowEnd >= totalBlocks;
        progress(isFinal ? 'refresh' : 'checkpoint', windowEnd - 1, totalBlocks, blockPayloadSize, payload.length);
        // Wait for the checkpoint; on timeout re-send the window-end block to solicit progress.
        let probes = 0;
        for (;;) {
          try {
            const ack = await expectAck(
              isFinal ? FINAL_ACK_TIMEOUT_MS : CHECKPOINT_TIMEOUT_MS,
              isFinal ? 'the 0x05/0x08 refresh acknowledgement' : 'the durable Flash checkpoint',
            );
            if (ack.end) {
              if (!isFinal) log('warn', 'Refresh acknowledgement arrived before the last window was sent; treating as complete');
              ended = true;
              break outer;
            }
            index = ack.index!;
            break;
          } catch (e) {
            if ((e as BleError).code !== 'timeout') throw e;
            if (isFinal) throw new BleError('Timed out waiting for the required 0x05/0x08 refresh acknowledgement', 'timeout');
            probes++;
            repairs++;
            if (repairs > MAX_REPAIR_REQUESTS || probes > 4) throw new BleError(`Timed out waiting for the durable checkpoint after ${repairs} probes`, 'timeout');
            const probeIndex = Math.max(windowEnd - 1, windowStart);
            log('warn', `Checkpoint timeout; re-sending window-end block ${probeIndex} to request device progress (${repairs}/${MAX_REPAIR_REQUESTS})`);
            await writeBlock(probeIndex, true);
          }
        }
      }
      if (!ended) throw new BleError('Transfer loop ended without the refresh acknowledgement', 'protocol');
    } else {
      // ---- Legacy streaming (pre-v157) ----
      let next = 0;
      const first = await expectAck(CONTROL_RESPONSE_TIMEOUT_MS * 2, 'initial block request');
      if (first.end) throw new BleError('Device ended the transfer before any data was sent', 'protocol');
      next = first.index!;
      while (next < totalBlocks) {
        throwIfAborted();
        await writeBlock(next, false);
        progress('sending', next, totalBlocks, blockPayloadSize, payload.length);
        next++;
        const m = channel.poll();
        if (m && m.kind === 'ack') {
          if (m.status === STATUS.transferEnd) {
            next = totalBlocks;
            channel.push(m);
            break;
          }
          if (m.status !== STATUS.success) throw new BleError(describeAckStatus(m.status), 'device');
          if (m.index !== undefined && m.index !== next) {
            log('warn', `Device requested block ${m.index}; resuming there`);
            next = m.index;
          }
        }
      }
      progress('refresh', totalBlocks - 1, totalBlocks, blockPayloadSize, payload.length);
      const fin = await expectAck(LEGACY_FINAL_ACK_TIMEOUT_MS, 'the 0x05/0x08 refresh acknowledgement');
      if (!fin.end) throw new BleError('Device did not acknowledge the refresh', 'protocol');
    }

    progress('done', totalBlocks - 1, totalBlocks, blockPayloadSize, payload.length);
    log('info', 'Transfer completed and refresh acknowledged by 0x05/0x08');
    try {
      await client.op(() => control.stopNotifications());
    } catch {
      /* ignore */
    }
    control.removeEventListener('characteristicvaluechanged', onNotify);
    return { ok: true, blocks: totalBlocks, bytes: payload.length, durationMs: Date.now() - started };
  } catch (e) {
    const err = e instanceof BleError ? e : new BleError((e as Error).message ?? String(e), 'unknown', e);
    log('error', `Transfer failed: ${err.message}`);
    if (opts.firmwareRaw >= FW.diagnostics && client.connected) {
      const d = await client.readDiagnostics();
      if (d) log('info', `Image-ACK diagnostics: session=${d.session} flags=0x${d.flags.toString(16)} generated=${d.generated} accepted=${d.accepted} rejected=${d.rejected} requestedBlock=${d.requestedBlock} previousStatus=0x${d.previousStatus.toString(16)} lastReceivedBlock=${d.lastReceivedBlock}`);
    }
    throw err;
  } finally {
    client.removeEventListener('disconnected', onDisconnect);
    client.busy = false;
  }
}

