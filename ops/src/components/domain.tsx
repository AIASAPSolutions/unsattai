/** Small pieces shared by order, production and CRM screens. */
import { useEffect, useState } from 'react';
import { post } from '../lib/api';
import { errorText } from '../lib/errors';
import type { OrderSummary, Spec } from '../lib/types';
import { Badge, StatusBadge } from './ui';
import { IconBolt, IconPause } from './icons';

const cache = new Map<string, Promise<string>>();

/** SVG mock-up for a design spec, rendered by POST /api/v1/render. Shown as an <img> so nothing in it runs. */
export function renderSpec(spec: Spec): Promise<string> {
  const key = JSON.stringify(spec);
  let p = cache.get(key);
  if (!p) {
    p = post<{ mockup_svg: string }>('/render', { spec }).then((r) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.mockup_svg)}`);
    p.catch(() => cache.delete(key));
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
    cache.set(key, p);
  }
  return p;
}

export function DesignPreview({ spec, svg, height = 260, alt }: { spec?: Spec | null; svg?: string; height?: number; alt?: string }) {
  const [src, setSrc] = useState<string | null>(svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (svg) { setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); return; }
    if (!spec) return;
    let live = true;
    setErr(null);
    renderSpec(spec).then((s) => live && setSrc(s)).catch((e) => live && setErr(errorText(e)));
    return () => { live = false; };
  }, [spec, svg]);
  return (
    <div className="mockup" style={{ height }} data-testid="design-preview">
      {src ? <img src={src} alt={alt ?? `Design ${spec?.style_name ?? ''}`} /> : err ? <span className="muted small" style={{ padding: 12 }}>Mock-up unavailable: {err}</span> : <span className="spinner" />}
    </div>
  );
}

export function OrderFlags({ o }: { o: Pick<OrderSummary, 'rush' | 'hold'> }) {
  return (
    <>
      {o.rush && <Badge tone="warn" title="Express production"><IconBolt width={11} height={11} />Rush</Badge>}
      {o.hold && <Badge tone="bad" title="On hold"><IconPause width={11} height={11} />Hold</Badge>}
    </>
  );
}

export function OrderStatus({ o }: { o: Pick<OrderSummary, 'fulfilment_status' | 'rush' | 'hold'> }) {
  return <span className="row tight"><StatusBadge status={o.fulfilment_status} /><OrderFlags o={o} /></span>;
}

/** Stable colour per production stage index (categorical, fixed order, never cycled past 8). */
export const STAGE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export function stageColor(i: number): string {
  return i < STAGE_COLORS.length ? STAGE_COLORS[i] : '#8b93a1';
}
