import { forwardRef } from 'react';
import type { ConfigResponse } from '@shared/api';
import { clearSettings, defaultSettings, type Settings } from '../lib/settings';

interface Props {
  settings: Settings;
  setSettings: (u: Partial<Settings> | ((s: Settings) => Settings)) => void;
  config: ConfigResponse | null;
}

export const SettingsDialog = forwardRef<HTMLDialogElement, Props>(function SettingsDialog({ settings, setSettings, config }, ref) {
  const setKey = (provider: string, field: string, value: string) =>
    setSettings((s) => ({ ...s, providerKeys: { ...s.providerKeys, [provider]: { ...(s.providerKeys[provider] ?? {}), [field]: value } } }));

  const groups: Array<['search' | 'generate', string]> = [
    ['search', 'Image search providers'],
    ['generate', 'Image generation providers'],
  ];

  return (
    <dialog ref={ref} className="settings">
      <form method="dialog" className="stack">
        <header className="row between">
          <h2>Settings</h2>
          <button className="btn" value="close">
            Close
          </button>
        </header>
        <p className="muted small">
          Keys are stored only in this browser (localStorage) and are sent to the API solely inside the request that uses them. The server never stores them.
          {config && !config.allowClientKeys && ' This server is configured to ignore client keys; it uses its own.'}
        </p>

        <section className="stack">
          <label className="field">
            <span>API access token {config?.requiresAppToken ? <em>(required by this server)</em> : <em>(only if the server requires one)</em>}</span>
            <input type="password" value={settings.appToken} onChange={(e) => setSettings({ appToken: e.target.value })} autoComplete="off" />
          </label>
          <label className="field row gap">
            <input type="checkbox" checked={settings.debugLog} onChange={(e) => setSettings({ debugLog: e.target.checked })} />
            <span>Show protocol-level debug messages in the log</span>
          </label>
        </section>

        {!config && <div className="banner warn">The API is not reachable, so provider settings cannot be listed. Upload and sending still work.</div>}

        {config &&
          groups.map(([kind, title]) => (
            <section key={kind} className="stack">
              <h3>{title}</h3>
              <label className="field">
                <span>Default</span>
                <select
                  value={kind === 'search' ? settings.searchProvider : settings.generateProvider}
                  onChange={(e) => setSettings(kind === 'search' ? { searchProvider: e.target.value } : { generateProvider: e.target.value })}
                >
                  {config.providers
                    .filter((p) => p.kind === kind)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              {config.providers
                .filter((p) => p.kind === kind)
                .map((p) => (
                  <div key={p.id} className="provider">
                    <div className="row between">
                      <strong>{p.name}</strong>
                      <span className="row gap">
                        {p.hasServerKey && <span className="chip ok small">server key</span>}
                        {p.fields.length === 0 && <span className="chip small">no key needed</span>}
                        {p.homepage && (
                          <a href={p.homepage} target="_blank" rel="noreferrer" className="small">
                            docs
                          </a>
                        )}
                      </span>
                    </div>
                    {p.notes && <p className="muted small">{p.notes}</p>}
                    {p.fields.map((f) => (
                      <label key={f.key} className="field">
                        <span>
                          {f.label}
                          {f.optional ? ' (optional)' : ''}
                        </span>
                        <input
                          type={f.secret ? 'password' : 'text'}
                          placeholder={f.placeholder ?? (p.hasServerKey ? 'using server key' : '')}
                          value={settings.providerKeys[p.id]?.[f.key] ?? ''}
                          onChange={(e) => setKey(p.id, f.key, e.target.value)}
                          autoComplete="off"
                          disabled={config && !config.allowClientKeys}
                        />
                        {f.help && <small className="muted">{f.help}</small>}
                      </label>
                    ))}
                  </div>
                ))}
            </section>
          ))}

        <footer className="row between">
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (confirm('Remove all keys and settings from this browser?')) {
                clearSettings();
                setSettings({ ...defaultSettings });
              }
            }}
          >
            Clear all settings
          </button>
          <button className="btn primary" value="close">
            Done
          </button>
        </footer>
      </form>
    </dialog>
  );
});
