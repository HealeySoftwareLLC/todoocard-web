import { useEffect, useRef } from 'react';
import { PANEL_HEIGHT, PANEL_WIDTH } from '@shared/protocol';
import { PREVIEW_RGB, PALETTE } from '@shared/image';
import { previewRgbForPalette, type DiffusionMatrix, type PaletteName, type PresetName } from '@shared/epd';
import { defaultCompose, defaultProcessing, drawRgbaToCanvas, type ComposeOptions, type Prepared, type ProcessingOptions } from '../lib/compose';

interface Props {
  bitmap: ImageBitmap | null;
  composed: ImageData | null;
  prepared: Prepared | null;
  compose: ComposeOptions;
  setCompose: (u: ComposeOptions | ((c: ComposeOptions) => ComposeOptions)) => void;
  processing: ProcessingOptions;
  setProcessing: (u: ProcessingOptions | ((p: ProcessingOptions) => ProcessingOptions)) => void;
  preparing: boolean;
}

const MATRICES: { value: DiffusionMatrix; label: string }[] = [
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { value: 'false-floyd-steinberg', label: 'False Floyd–Steinberg' },
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'jarvis', label: 'Jarvis' },
  { value: 'stucki', label: 'Stucki' },
  { value: 'burkes', label: 'Burkes' },
  { value: 'sierra3', label: 'Sierra' },
  { value: 'sierra2', label: 'Sierra 2-row' },
  { value: 'sierra2-4a', label: 'Sierra Lite' },
];
const PALETTES: { value: PaletteName; label: string }[] = [
  { value: 'spectra6-aitjcize', label: 'Spectra 6 (default)' },
  { value: 'spectra6', label: 'Spectra 6 (measured)' },
  { value: 'spectra6-legacy', label: 'Spectra 6 (legacy)' },
];
const PRESETS: { value: PresetName; label: string }[] = [
  { value: 'balanced', label: 'Faithful (recommended)' },
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'soft', label: 'Soft' },
  { value: 'grayscale', label: 'Grayscale' },
];

export function Editor({ bitmap, composed, prepared, compose, setCompose, processing, setProcessing, preparing }: Props) {
  const srcRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (composed && srcRef.current) drawRgbaToCanvas(srcRef.current, composed.data, PANEL_WIDTH, PANEL_HEIGHT);
  }, [composed]);
  useEffect(() => {
    if (prepared && outRef.current) drawRgbaToCanvas(outRef.current, prepared.previewRgba, PANEL_WIDTH, PANEL_HEIGHT);
  }, [prepared]);

  const set = (patch: Partial<ComposeOptions>) => setCompose((c) => ({ ...c, ...patch }));
  const setP = (patch: Partial<ProcessingOptions>) => setProcessing((p) => ({ ...p, ...patch }));
  const ink = processing.engine === 'classic' ? PREVIEW_RGB : previewRgbForPalette(processing.palette);
  const inkOf = (code: number): [number, number, number] => ink[code] ?? PREVIEW_RGB[code] ?? [255, 0, 255];
  const canPan = compose.fit === 'cover' || compose.zoom > 1;

  return (
    <div className="card">
      <h2>Preview</h2>
      {!bitmap && <p className="muted">Pick an image above. The right-hand preview shows exactly what the card will display (six inks, dithered).</p>}
      {bitmap && (
        <div className="editor">
          <div className="previews">
            <figure>
              <canvas ref={srcRef} className="panel-canvas" />
              <figcaption>Composed source · {bitmap.width}×{bitmap.height}</figcaption>
            </figure>
            <figure>
              <canvas ref={outRef} className={`panel-canvas ${preparing ? 'dim' : ''}`} />
              <figcaption>Card preview · 528×792 · six inks</figcaption>
            </figure>
          </div>
          <div className="controls">
            <div className="ctrl">
              <label>Rendering</label>
              <div className="seg">
                <button className={processing.engine === 'enhanced' ? 'active' : ''} onClick={() => setP({ engine: 'enhanced' })} title="Ported vendor engine: measured inks, tone and dynamic-range handling">
                  Enhanced
                </button>
                <button className={processing.engine === 'classic' ? 'active' : ''} onClick={() => setP({ engine: 'classic' })} title="Plain Floyd–Steinberg against pure primaries">
                  Classic
                </button>
              </div>
            </div>
            {processing.engine === 'enhanced' && (
              <>
                <div className="ctrl">
                  <label>Style</label>
                  <select value={processing.preset} onChange={(e) => setP({ preset: e.target.value as PresetName })}>
                    {PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <details className="advanced">
                  <summary className="muted small">Advanced dithering</summary>
                  <div className="ctrl">
                    <label>Palette</label>
                    <select value={processing.palette} onChange={(e) => setP({ palette: e.target.value as PaletteName })}>
                      {PALETTES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ctrl">
                    <label>Diffusion</label>
                    <select value={processing.matrix} onChange={(e) => setP({ matrix: e.target.value as DiffusionMatrix })}>
                      {MATRICES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ctrl">
                    <label>Colour match</label>
                    <div className="seg">
                      <button className={processing.matching === 'rgb' ? 'active' : ''} onClick={() => setP({ matching: 'rgb' })}>
                        RGB
                      </button>
                      <button className={processing.matching === 'lab' ? 'active' : ''} onClick={() => setP({ matching: 'lab' })} title="Perceptual CIELAB matching (slower, often more accurate)">
                        LAB
                      </button>
                    </div>
                  </div>
                  <button className="btn small" onClick={() => setProcessing({ ...defaultProcessing })}>
                    Reset dithering
                  </button>
                </details>
              </>
            )}
            <div className="ctrl">
              <label>Fit</label>
              <div className="seg">
                <button className={compose.fit === 'cover' ? 'active' : ''} onClick={() => set({ fit: 'cover' })}>
                  Fill (crop)
                </button>
                <button className={compose.fit === 'contain' ? 'active' : ''} onClick={() => set({ fit: 'contain' })}>
                  Fit (pad)
                </button>
              </div>
            </div>
            <div className="ctrl">
              <label>Rotate</label>
              <div className="seg">
                <button onClick={() => set({ rotate: ((compose.rotate + 270) % 360) as ComposeOptions['rotate'] })}>↺ 90°</button>
                <button onClick={() => set({ rotate: ((compose.rotate + 90) % 360) as ComposeOptions['rotate'] })}>↻ 90°</button>
                <span className="muted small">{compose.rotate}°</span>
              </div>
            </div>
            <Slider label="Zoom" value={compose.zoom} min={1} max={3} step={0.01} onChange={(v) => set({ zoom: v })} fmt={(v) => `${v.toFixed(2)}×`} />
            <Slider label="Pan X" value={compose.panX} min={-1} max={1} step={0.01} disabled={!canPan} onChange={(v) => set({ panX: v })} />
            <Slider label="Pan Y" value={compose.panY} min={-1} max={1} step={0.01} disabled={!canPan} onChange={(v) => set({ panY: v })} />
            <div className="ctrl">
              <label>Background</label>
              <div className="row gap">
                <input type="color" value={compose.background} onChange={(e) => set({ background: e.target.value })} />
                {PALETTE.map((p) => (
                  <button
                    key={p.code}
                    className="swatch"
                    title={p.name}
                    style={{ background: `rgb(${inkOf(p.code).join(',')})` }}
                    onClick={() => set({ background: `#${[p.r, p.g, p.b].map((n) => n.toString(16).padStart(2, '0')).join('')}` })}
                  />
                ))}
              </div>
            </div>
            <Slider label="Brightness" value={compose.brightness} min={0.5} max={1.5} step={0.01} onChange={(v) => set({ brightness: v })} />
            <Slider label="Contrast" value={compose.contrast} min={0.5} max={1.8} step={0.01} onChange={(v) => set({ contrast: v })} />
            <Slider label="Saturation" value={compose.saturation} min={0} max={2.5} step={0.01} onChange={(v) => set({ saturation: v })} />
            <button className="btn" onClick={() => setCompose({ ...defaultCompose })}>
              Reset adjustments
            </button>
            {prepared && (
              <div className="usage" title="Share of each ink in the output">
                {PALETTE.map((p) => (
                  <span key={p.code} style={{ width: `${prepared.usage[p.name]}%`, background: `rgb(${inkOf(p.code).join(',')})` }} title={`${p.name} ${prepared.usage[p.name]}%`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, disabled, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean; fmt?: (v: number) => string }) {
  return (
    <div className="ctrl">
      <label>
        {label} <span className="muted small">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}
