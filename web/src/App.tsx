import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigResponse } from '@shared/api';
import { DevicePanel } from './components/DevicePanel';
import { Editor } from './components/Editor';
import { SendPanel } from './components/SendPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { SourcePanel, type SourceImage } from './components/SourcePanel';
import { useClient } from './hooks/useClient';
import { useSettings } from './hooks/useSettings';
import { getConfig, type ApiError } from './lib/api';
import { isWebBluetoothSupported } from './lib/ble';
import { composeToPanel, defaultCompose, loadBitmap, prepareFromImageData, type ComposeOptions, type Prepared } from './lib/compose';

export function App() {
  const { settings, setSettings } = useSettings();
  const { client, info, connected, log, clearLog } = useClient();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeOptions>(defaultCompose);
  const [composed, setComposed] = useState<ImageData | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, setPreparing] = useState(false);
  const settingsRef = useRef<HTMLDialogElement>(null);
  const workCanvas = useMemo(() => document.createElement('canvas'), []);

  useEffect(() => {
    getConfig(settings)
      .then((c) => {
        setConfig(c);
        setConfigError(null);
      })
      .catch((e) => {
        setConfig(null);
        setConfigError((e as ApiError).status === 401 ? 'token' : (e as Error).message);
      });
    // Re-fetch when the app token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.appToken]);

  useEffect(() => {
    if (!source) {
      setBitmap(null);
      return;
    }
    let cancelled = false;
    setSourceError(null);
    loadBitmap(source.blob)
      .then((b) => {
        if (cancelled) b.close();
        else setBitmap(b);
      })
      .catch((e) => {
        if (!cancelled) setSourceError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (!bitmap) {
      setComposed(null);
      setPrepared(null);
      return;
    }
    setPreparing(true);
    const t = setTimeout(() => {
      try {
        const img = composeToPanel(bitmap, compose, workCanvas);
        setComposed(img);
        setPrepared(prepareFromImageData(img));
      } catch (e) {
        setSourceError((e as Error).message);
      } finally {
        setPreparing(false);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [bitmap, compose, workCanvas]);

  const onSource = useCallback((s: SourceImage) => {
    setSource(s);
    setCompose((c) => ({ ...c, rotate: 0, zoom: 1, panX: 0, panY: 0 }));
  }, []);

  const supported = isWebBluetoothSupported();
  const secure = typeof window !== 'undefined' ? window.isSecureContext : true;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>TodooCard Web</h1>
          <p className="sub">Pair, prepare and flash six-colour e-paper cards from Chrome</p>
        </div>
        <div className="topbar-actions">
          {config ? (
            <span className="chip ok">API v{config.version}</span>
          ) : configError === 'token' ? (
            <button className="chip warn as-button" title="This server requires an access token. Enter it in Settings." onClick={() => settingsRef.current?.showModal()}>
              API: token required
            </button>
          ) : (
            <span className="chip warn" title={configError ?? ''}>
              API offline
            </span>
          )}
          <button className="btn" onClick={() => settingsRef.current?.showModal()}>
            Settings
          </button>
        </div>
      </header>

      {!supported && (
        <div className="banner error">
          Web Bluetooth is not available in this browser. Use Chrome or Edge on desktop, Android or ChromeOS. {!secure && 'This page must also be served over https (or localhost).'}
        </div>
      )}
      {supported && !secure && <div className="banner error">Web Bluetooth requires a secure context: open this page over https or on localhost.</div>}

      <main className="layout">
        <aside className="col col-device">
          <DevicePanel client={client} info={info} connected={connected} />
        </aside>
        <section className="col col-image">
          <SourcePanel settings={settings} config={config} onSource={onSource} current={source} />
          {sourceError && <div className="banner error">{sourceError}</div>}
          <Editor bitmap={bitmap} composed={composed} prepared={prepared} compose={compose} setCompose={setCompose} preparing={preparing} />
        </section>
        <aside className="col col-send">
          <SendPanel client={client} info={info} connected={connected} prepared={prepared} sourceName={source?.name} log={log} clearLog={clearLog} debug={settings.debugLog} />
        </aside>
      </main>

      <footer className="foot">
        <span>
          Unofficial tool for TodooCard / T3 528x792 cards. Images you upload stay in this browser; search and generation go through the API using your own keys.
        </span>
        <a href="https://github.com/brianhealey/todoocard-web" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>

      <SettingsDialog ref={settingsRef} settings={settings} setSettings={setSettings} config={config} />
    </div>
  );
}
