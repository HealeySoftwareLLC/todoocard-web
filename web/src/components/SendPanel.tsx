import { useRef, useState } from 'react';
import { selectPayload } from '@shared/payload';
import { FW } from '@shared/protocol';
import type { DeviceInfo, LogEntry, TodooCardClient } from '../lib/ble';
import type { Prepared } from '../lib/compose';
import { runTransfer, type TransferProgress } from '../lib/transfer';

/** Vendor refuses a transfer below this battery level (MIN_OPERATION_BATTERY_PERCENT). */
const MIN_OPERATION_BATTERY = 5;
/** Below this we warn but still allow the send. */
const LOW_BATTERY_WARN = 20;

interface Props {
  client: TodooCardClient;
  info: DeviceInfo | null;
  connected: boolean;
  prepared: Prepared | null;
  sourceName?: string;
  log: LogEntry[];
  clearLog: () => void;
  debug: boolean;
}

export function SendPanel({ client, info, connected, prepared, sourceName, log, clearLog, debug }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fw = info?.firmwareRaw;
  const ready = connected && !!info?.bonded && !!prepared && fw !== undefined;
  const payload = prepared && fw !== undefined ? selectPayload(prepared.bitmaps.controller, fw) : null;
  const estBlocks = payload ? Math.ceil(payload.bytes.length / 240) : 0;
  const otaRecovery = info?.flags?.otaRecovery ?? false;
  const pairingOpen = info?.flags?.pairingWindowOpen ?? false;
  const battery = info?.battery;
  const batteryBlocked = battery !== undefined && battery < MIN_OPERATION_BATTERY;
  const batteryLow = battery !== undefined && battery >= MIN_OPERATION_BATTERY && battery < LOW_BATTERY_WARN;

  const send = async () => {
    if (!payload || fw === undefined) return;
    setConfirming(false);
    setRunning(true);
    setError(null);
    setResult(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await runTransfer(client, { payload, firmwareRaw: fw, signal: ac.signal, onProgress: setProgress });
      setResult(`Done: ${r.blocks} blocks (${(r.bytes / 1024).toFixed(0)} KB) in ${(r.durationMs / 1000).toFixed(0)} s. The card now refreshes its display (20-30 s) and usually disconnects while doing so; reconnect afterwards if you want to send another image.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const visibleLog = debug ? log : log.filter((l) => l.level !== 'debug');

  return (
    <div className="card">
      <h2>Send to card</h2>
      <ul className="checklist">
        <li className={connected && info?.bonded ? 'ok' : ''}>Card connected and bonded</li>
        <li className={prepared ? 'ok' : ''}>Image prepared{sourceName ? `: ${sourceName}` : ''}</li>
        <li className={fw !== undefined ? 'ok' : ''}>Firmware known{fw !== undefined ? ` (v${fw})` : ''}</li>
      </ul>
      {payload && (
        <p className="muted small">
          {payload.profile === 'raw' ? 'Raw controller bitmap' : 'Legacy QuickLZ stored stream'} · {payload.bytes.length.toLocaleString()} bytes · ≈{estBlocks} blocks
          {fw !== undefined && fw >= FW.verifiedTransfer ? ' · verified windows with Flash checkpoints' : ''}
        </p>
      )}
      {otaRecovery && <div className="banner error">The card advertises OTA recovery mode. Image transfer is refused; repair the firmware with the vendor app first.</div>}
      {pairingOpen && <div className="banner warn">The pairing window is open. Wait for it to close (about a minute) before sending.</div>}
      {batteryBlocked && <div className="banner error">Battery is {battery}%. Sending is blocked below {MIN_OPERATION_BATTERY}% — a transfer that stalls mid-refresh can leave a half-drawn image. Charge the card first.</div>}
      {batteryLow && <div className="banner warn">Battery is {battery}%. You can send, but charging first is safer (a refresh takes 20-30 s).</div>}

      {!running && !confirming && (
        <button className="btn primary big" disabled={!ready || otaRecovery || pairingOpen || batteryBlocked} onClick={() => setConfirming(true)}>
          Send to card
        </button>
      )}
      {confirming && (
        <div className="confirm">
          <p>
            Replace the picture on <strong>{info?.name}</strong> ({info?.serial ?? info?.id})? The current image is lost unless you have it saved.
          </p>
          <div className="row gap">
            <button className="btn primary" onClick={send}>
              Yes, send now
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {running && progress && (
        <div className="progress">
          <div className="bar">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="row between small">
            <span>
              {progress.phase === 'handshake' && 'Negotiating…'}
              {progress.phase === 'sending' && `Sending block ${progress.blockIndex + 1} / ${progress.totalBlocks}`}
              {progress.phase === 'checkpoint' && 'Waiting for Flash checkpoint…'}
              {progress.phase === 'refresh' && 'Waiting for the refresh acknowledgement…'}
            </span>
            <span>{progress.percent}%</span>
          </div>
          <button className="btn" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {result && <div className="banner ok">{result}</div>}
      {error && <div className="banner error">{error}</div>}

      <details className="log">
        <summary>
          Log <span className="muted small">({visibleLog.length})</span>
        </summary>
        <div className="row gap">
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(log.map((l) => `${new Date(l.t).toISOString()} ${l.level} ${l.msg}`).join('\n'))}>
            Copy
          </button>
          <button className="btn small" onClick={clearLog}>
            Clear
          </button>
        </div>
        <pre className="logbox">
          {visibleLog.map((l, i) => (
            <div key={i} className={`line ${l.level}`}>
              <span className="muted">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
            </div>
          ))}
        </pre>
      </details>
    </div>
  );
}
