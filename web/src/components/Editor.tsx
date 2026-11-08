import { useEffect, useRef } from 'react';
import { PANEL_HEIGHT, PANEL_WIDTH } from '@shared/protocol';
import { PREVIEW_RGB, PALETTE } from '@shared/image';
import { defaultCompose, drawRgbaToCanvas, type ComposeOptions, type Prepared } from '../lib/compose';

interface Props {
  bitmap: ImageBitmap | null;
  composed: ImageData | null;
  prepared: Prepared | null;
  compose: ComposeOptions;
  setCompose: (u: ComposeOptions | ((c: ComposeOptions) => ComposeOptions)) => void;
  preparing: boolean;
}

export function Editor({ bitmap, composed, prepared, compose, setCompose, preparing }: Props) {
  const srcRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (composed && srcRef.current) drawRgbaToCanvas(srcRef.current, composed.data, PANEL_WIDTH, PANEL_HEIGHT);
  }, [composed]);
  useEffect(() => {
    if (prepared && outRef.current) drawRgbaToCanvas(outRef.current, prepared.previewRgba, PANEL_WIDTH, PANEL_HEIGHT);
  }, [prepared]);

  const set = (patch: Partial<ComposeOptions>) => setCompose((c) => ({ ...c, ...patch }));
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
                    style={{ background: `rgb(${PREVIEW_RGB[p.code].join(',')})` }}
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
                  <span key={p.code} style={{ width: `${prepared.usage[p.name]}%`, background: `rgb(${PREVIEW_RGB[p.code].join(',')})` }} title={`${p.name} ${prepared.usage[p.name]}%`} />
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
