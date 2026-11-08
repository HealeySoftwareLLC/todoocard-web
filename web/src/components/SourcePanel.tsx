import { useEffect, useMemo, useRef, useState } from 'react';
import type { Aspect, ConfigResponse, Orientation, SearchResult } from '@shared/api';
import { fetchRemoteImage, generateImage, searchImages } from '../lib/api';
import type { Settings } from '../lib/settings';

export interface SourceImage {
  blob: Blob;
  name: string;
  origin: 'upload' | 'search' | 'generate' | 'paste';
  attribution?: string;
}

interface Props {
  settings: Settings;
  config: ConfigResponse | null;
  onSource: (s: SourceImage) => void;
  current: SourceImage | null;
}

type Tab = 'upload' | 'search' | 'generate';

export function SourcePanel({ settings, config, onSource, current }: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  return (
    <div className="card">
      <div className="tabs">
        {(['upload', 'search', 'generate'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'upload' ? 'Upload' : t === 'search' ? 'Search the web' : 'Generate with AI'}
          </button>
        ))}
        {current && (
          <span className="muted small current">
            Current: {current.name} {current.attribution ? `· ${current.attribution}` : ''}
          </span>
        )}
      </div>
      {tab === 'upload' && <UploadTab onSource={onSource} />}
      {tab === 'search' && <SearchTab settings={settings} config={config} onSource={onSource} />}
      {tab === 'generate' && <GenerateTab settings={settings} config={config} onSource={onSource} />}
    </div>
  );
}

function UploadTab({ onSource }: { onSource: (s: SourceImage) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const take = (file: File | null | undefined, origin: SourceImage['origin'] = 'upload') => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) return;
    onSource({ blob: file, name: file.name || 'pasted image', origin });
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) take(new File([f], `pasted-${Date.now()}.png`, { type: f.type }), 'paste');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`drop ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <p>
        Drop a JPEG, PNG, WebP or GIF here, paste an image, or
        <button className="btn link" onClick={() => inputRef.current?.click()}>
          choose a file
        </button>
      </p>
      <p className="muted small">The image never leaves your browser. Portrait 2:3 images fill the 528×792 panel exactly; EXIF rotation is applied automatically. HEIC is not supported by Chrome.</p>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
    </div>
  );
}

function providerOptions(config: ConfigResponse | null, settings: Settings, kind: 'search' | 'generate') {
  return (config?.providers ?? [])
    .filter((p) => p.kind === kind)
    .map((p) => {
      const required = p.fields.filter((f) => !f.optional);
      const clientHas = required.every((f) => !!settings.providerKeys[p.id]?.[f.key]);
      const ready = required.length === 0 || p.hasServerKey || clientHas;
      return { ...p, ready };
    });
}

function SearchTab({ settings, config, onSource }: Omit<Props, 'current'>) {
  const providers = useMemo(() => providerOptions(config, settings, 'search'), [config, settings]);
  const [provider, setProvider] = useState(settings.searchProvider);
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (providers.length && !providers.some((p) => p.id === provider)) setProvider(providers.find((p) => p.ready)?.id ?? providers[0].id);
  }, [providers, provider]);

  const run = async (p: number) => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await searchImages(settings, provider, query, p, orientation);
      setResults(p === 1 ? r.results : (prev) => [...prev, ...r.results]);
      setPage(p);
      setHasMore(r.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (r: SearchResult) => {
    setLoading(r.id);
    setError(null);
    try {
      const blob = await fetchRemoteImage(settings, r.imageUrl);
      onSource({ blob, name: r.title || r.imageUrl.split('/').pop() || 'image', origin: 'search', attribution: [r.author, r.license].filter(Boolean).join(', ') });
    } catch (e) {
      setError(`Could not load image: ${(e as Error).message}`);
    } finally {
      setLoading(null);
    }
  };

  if (!config) return <p className="muted">Search needs the backend API, which is not reachable right now.</p>;
  const sel = providers.find((p) => p.id === provider);

  return (
    <div className="stack">
      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(1);
        }}
      >
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.ready ? '' : ' (needs key)'}
            </option>
          ))}
        </select>
        <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search images…" />
        <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
          <option value="portrait">portrait</option>
          <option value="landscape">landscape</option>
          <option value="any">any</option>
        </select>
        <button className="btn primary" disabled={busy || !query.trim() || !sel?.ready}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {sel && !sel.ready && <div className="banner warn">{sel.name} needs an API key. Add yours in Settings.</div>}
      {sel?.notes && <p className="muted small">{sel.notes}</p>}
      {error && <div className="banner error">{error}</div>}
      <div className="grid-results">
        {results.map((r) => (
          <button key={`${r.provider}-${r.id}`} className={`thumb ${loading === r.id ? 'loading' : ''}`} onClick={() => pick(r)} title={r.title ?? ''}>
            <img src={r.thumbnailUrl} alt={r.title ?? ''} loading="lazy" referrerPolicy="no-referrer" />
            <span className="thumb-meta">
              {r.width && r.height ? `${r.width}×${r.height}` : ''} {r.author ? `· ${r.author}` : ''}
            </span>
          </button>
        ))}
      </div>
      {hasMore && (
        <button className="btn" disabled={busy} onClick={() => run(page + 1)}>
          Load more
        </button>
      )}
    </div>
  );
}

function GenerateTab({ settings, config, onSource }: Omit<Props, 'current'>) {
  const providers = useMemo(() => providerOptions(config, settings, 'generate'), [config, settings]);
  const [provider, setProvider] = useState(settings.generateProvider);
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('2:3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; meta?: Record<string, unknown> } | null>(null);

  useEffect(() => {
    if (providers.length && !providers.some((p) => p.id === provider)) setProvider(providers.find((p) => p.ready)?.id ?? providers[0].id);
  }, [providers, provider]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, meta } = await generateImage(settings, provider, prompt, aspect);
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), blob, meta });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <p className="muted">Generation needs the backend API, which is not reachable right now.</p>;
  const sel = providers.find((p) => p.id === provider);

  return (
    <div className="stack">
      <div className="row gap wrap">
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.ready ? '' : ' (needs key)'}
            </option>
          ))}
        </select>
        <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
          <option value="2:3">portrait 2:3 (card)</option>
          <option value="3:2">landscape 3:2</option>
          <option value="1:1">square</option>
        </select>
      </div>
      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the picture. Bold shapes and saturated red, yellow, blue and green dither best on this panel." />
      <div className="row gap">
        <button className="btn primary" disabled={busy || !prompt.trim() || !sel?.ready} onClick={run}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
        {sel && !sel.ready && <span className="muted small">{sel.name} needs a key: add it in Settings.</span>}
      </div>
      {sel?.notes && <p className="muted small">{sel.notes}</p>}
      {error && <div className="banner error">{error}</div>}
      {result && (
        <div className="gen-result">
          <img src={result.url} alt="generated" />
          <div className="stack">
            <button className="btn primary" onClick={() => onSource({ blob: result.blob, name: `generated: ${prompt.slice(0, 40)}`, origin: 'generate', attribution: sel?.name })}>
              Use this image
            </button>
            {result.meta && <pre className="small mono">{JSON.stringify(result.meta, null, 1)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}
