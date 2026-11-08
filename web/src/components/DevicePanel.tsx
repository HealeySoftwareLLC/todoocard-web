import { useState } from 'react';
import { FW, STATUS, hex } from '@shared/protocol';
import { BleError, type DeviceInfo, type DiagSnapshot, type TodooCardClient } from '../lib/ble';

interface Props {
  client: TodooCardClient;
  info: DeviceInfo | null;
  connected: boolean;
}

export function DevicePanel({ client, info, connected }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  const connect = async (reuse: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (!reuse || !client.device) await client.requestDevice();
      await client.connectAndIdentify();
    } catch (e) {
      const err = e as BleError;
      if (err.code !== 'cancelled') setError({ message: err.message, code: err.code ?? 'error' });
      client.log('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const fw = info?.firmwareRaw;
  const profile = fw === undefined ? '?' : fw >= FW.verifiedTransfer ? 'raw bitmap, verified windows (v157+)' : 'legacy stored stream (pre-v157)';

  return (
    <div className="card">
      <h2>Card</h2>
      {!info && <p className="muted">Connect a TodooCard over Bluetooth. Chrome shows a chooser; pick the card (it advertises as “TodooCard”).</p>}
      <div className="row gap">
        <button className="btn primary" disabled={busy} onClick={() => connect(false)}>
          {busy ? 'Connecting…' : info ? 'Choose another card' : 'Connect card'}
        </button>
        {info && !connected && (
          <button className="btn" disabled={busy} onClick={() => connect(true)}>
            Reconnect
          </button>
        )}
        {connected && (
          <button className="btn" disabled={busy} onClick={() => connect(true)}>
            Refresh
          </button>
        )}
        {connected && (
          <button className="btn" disabled={busy} onClick={() => client.disconnect()}>
            Disconnect
          </button>
        )}
      </div>

      {error && (
        <div className={`banner ${error.code === 'notbonded' || error.code === 'auth' ? 'warn' : 'error'}`}>
          <strong>{error.code === 'notbonded' || error.code === 'auth' ? 'Pairing needed' : 'Error'}:</strong> {error.message}
        </div>
      )}

      {info && (
        <table className="kv">
          <tbody>
            <tr>
              <th>Status</th>
              <td>
                <span className={`dot ${connected ? 'on' : 'off'}`} /> {connected ? 'connected' : 'disconnected'}
                {info.bonded && connected && <span className="chip ok small">encrypted link verified</span>}
              </td>
            </tr>
            <tr>
              <th>Name</th>
              <td>{info.name}</td>
            </tr>
            {info.model && (
              <tr>
                <th>Model</th>
                <td>{info.model}</td>
              </tr>
            )}
            {info.serial && (
              <tr>
                <th>Serial</th>
                <td className="mono">{info.serial}</td>
              </tr>
            )}
            <tr>
              <th>Firmware</th>
              <td>
                {fw !== undefined ? `v${fw} (0x${fw.toString(16).toUpperCase()})` : info.firmwareString ?? 'unknown'}
              </td>
            </tr>
            {info.hardware && (
              <tr>
                <th>Hardware</th>
                <td>rev {info.hardware}</td>
              </tr>
            )}
            {info.manufacturer && (
              <tr>
                <th>Maker</th>
                <td>{info.manufacturer}</td>
              </tr>
            )}
            <tr>
              <th>Battery</th>
              <td>
                {info.battery !== undefined ? `${info.battery}%` : '—'}
                {info.batteryLive && connected && <span className="chip ok small" title="Updated by notifications from the card">live</span>}
              </td>
            </tr>
            <tr>
              <th>Transfer</th>
              <td>{profile}</td>
            </tr>
            {info.flags && (
              <tr>
                <th>Flags</th>
                <td>
                  {info.flags.secure && <span className="chip small">secure</span>} {info.flags.turboLink && <span className="chip small">turbo</span>}{' '}
                  {info.flags.pairingWindowOpen && <span className="chip warn small">pairing window open</span>}{' '}
                  {info.flags.otaRecovery && <span className="chip error small">OTA recovery</span>}
                  {info.rssi !== undefined && <span className="muted"> RSSI {info.rssi}</span>}
                </td>
              </tr>
            )}
            {info.diagnostics && (
              <tr>
                <th>Last transfer</th>
                <td className="mono small">
                  session {info.diagnostics.session}, accepted {info.diagnostics.accepted}, rejected {info.diagnostics.rejected}, last block {info.diagnostics.lastReceivedBlock}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {info && (info.snapshots?.length ?? 0) > 0 && <RawDiagnostics client={client} info={info} connected={connected} />}

      <details className="help" open={!!error && (error.code === 'notbonded' || error.code === 'auth')}>
        <summary>How pairing works</summary>
        <ol>
          <li>The card only accepts a new computer while its pairing window is open. Find the button on the back: it is flush and invisible, under the surface near the edge.</li>
          <li>Hold it for about 5 seconds until the front light flashes quickly. The window stays open for 60 seconds.</li>
          <li>Click <em>Connect card</em>, pick the card in the chooser and accept the system pairing prompt if one appears.</li>
          <li>Once bonded, the card reconnects without the button. A card that drops the link after a second is refusing an unbonded computer.</li>
        </ol>
        <p className="muted small">Pairing proof is a successful encrypted read of the Battery Level characteristic, the same check the vendor tooling uses.</p>
      </details>
    </div>
  );
}


function RawDiagnostics({ client, info, connected }: { client: TodooCardClient; info: DeviceInfo; connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const snaps = info.snapshots ?? [];
  const latest = snaps[snaps.length - 1];
  const d = latest?.diagnostics;
  const flagBits = (f: number) =>
    [f & 0x01 ? 'active' : '', f & 0x02 ? 'pending' : '', f & 0x04 ? 'block-received' : '', f & 0x08 ? 'last-accepted' : ''].filter(Boolean).join(', ') || 'none';
  const statusName = (v: number) => (v === STATUS.transferEnd ? 'refresh done' : v === STATUS.success ? 'ok' : `0x${v.toString(16).padStart(2, '0')}`);

  return (
    <details className="help">
      <summary>Raw diagnostics</summary>
      <p className="muted small">
        Two vendor records: the documented image-ACK record (…1003) and an undocumented 22-byte status record (…1002). Snapshots are taken at connect and before/after each
        send; bytes that changed since the previous snapshot are highlighted so the status record can be decoded over time.
      </p>
      <div className="row gap">
        <button
          className="btn small"
          disabled={!connected || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await client.readDiagnostics('manual');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Reading…' : 'Read now'}
        </button>
        <button
          className="btn small"
          onClick={() =>
            navigator.clipboard?.writeText(
              snaps.map((s) => `${new Date(s.t).toISOString()} ${s.label}\n  status=${s.status ? hex(s.status) : '-'}\n  imageAck=${s.imageAck ? hex(s.imageAck) : '-'}`).join('\n'),
            )
          }
        >
          Copy snapshots
        </button>
      </div>
      {d && (
        <table className="kv small">
          <tbody>
            <tr>
              <th>Session</th>
              <td>{d.session}</td>
            </tr>
            <tr>
              <th>Flags</th>
              <td>
                0x{d.flags.toString(16).padStart(2, '0')} ({flagBits(d.flags)})
              </td>
            </tr>
            <tr>
              <th>Acks</th>
              <td>
                generated {d.generated}, attempts {d.attempts}, accepted {d.accepted}, rejected {d.rejected}
              </td>
            </tr>
            <tr>
              <th>Blocks</th>
              <td>
                requested {d.requestedBlock}, last received {d.lastReceivedBlock}
              </td>
            </tr>
            <tr>
              <th>Results</th>
              <td>
                previous {statusName(d.previousStatus)}, last notify {statusName(d.lastNotifyResult)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="snapshots">
        {snaps.map((s, i) => (
          <SnapshotRow key={s.t} snap={s} prev={i > 0 ? snaps[i - 1] : undefined} />
        ))}
      </div>
    </details>
  );
}

function HexBytes({ bytes, prev }: { bytes?: Uint8Array; prev?: Uint8Array }) {
  if (!bytes) return <span className="muted">—</span>;
  return (
    <span className="hexbytes">
      {Array.from(bytes).map((b, i) => (
        <span key={i} className={prev && prev[i] !== b ? 'changed' : ''}>
          {b.toString(16).padStart(2, '0')}
        </span>
      ))}
    </span>
  );
}

function SnapshotRow({ snap, prev }: { snap: DiagSnapshot; prev?: DiagSnapshot }) {
  return (
    <div className="snapshot mono small">
      <div className="muted">
        {new Date(snap.t).toLocaleTimeString()} · {snap.label}
      </div>
      <div>
        <span className="muted">1002 </span>
        <HexBytes bytes={snap.status} prev={prev?.status} />
      </div>
      <div>
        <span className="muted">1003 </span>
        <HexBytes bytes={snap.imageAck} prev={prev?.imageAck} />
      </div>
    </div>
  );
}
