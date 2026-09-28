import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LeadForm, leadInput } from '../../components/crm';
import { IconPlus } from '../../components/icons';
import { Alert, Badge, Button, ErrorBox, Kpi, Loading, PageHeader, SearchInput, useToast } from '../../components/ui';
import { get, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { day, label, money0, pct } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Lead } from '../../lib/types';

interface Pipeline { stages: { stage: string; count: number; value: number; leads: Lead[] }[]; win_rate: number | null; open_value: number }

export default function Leads() {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { currency, staffName } = useRefData();
  const d = useLoad(() => get<Pipeline>('/ops/leads/pipeline'), []);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const canMove = can('crm');

  const move = async (l: Lead, stage: string) => {
    if (l.stage === stage) return;
    // optimistic: move the card, then save; reload either way so totals are the server's
    d.setData((p) => p && { ...p, stages: p.stages.map((c) => ({ ...c,
      leads: c.stage === stage ? [{ ...l, stage }, ...c.leads] : c.leads.filter((x) => x.id !== l.id) })) });
    try {
      await put(`/ops/leads/${l.id}`, leadInput(l, { stage }));
      toast.success(`${l.title} → ${label(stage)}`);
    } catch (e) {
      toast.error(e);
    }
    await d.reload();
  };

  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const p = d.data;
  const match = (l: Lead) => !q || `${l.title} ${l.notes} ${l.source}`.toLowerCase().includes(q.toLowerCase());
  const open = p.stages.filter((s) => s.stage !== 'won' && s.stage !== 'lost');
  const won = p.stages.find((s) => s.stage === 'won');

  return (
    <>
      <PageHeader title="Leads" subtitle="Drag a card to another stage, or use its menu."
        actions={canMove && <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)} data-testid="new-lead">New lead</Button>} />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi k="Open leads" v={open.reduce((a, s) => a + s.count, 0)} />
        <Kpi k="Open pipeline value" v={money0(p.open_value, currency)} />
        <Kpi k="Won" v={won?.count ?? 0} s={money0(won?.value ?? 0, currency)} />
        <Kpi k="Win rate" v={p.win_rate === null ? '—' : pct(p.win_rate)} s="Won ÷ (won + lost)" />
      </div>
      <div className="row" style={{ marginBottom: 12 }}><SearchInput value={q} onChange={setQ} placeholder="Filter cards…" /></div>
      {!canMove && <div style={{ marginBottom: 12 }}><Alert>Your role can view the pipeline but not move leads.</Alert></div>}
      <div className="board" data-testid="pipeline">
        {p.stages.map((c) => (
          <div key={c.stage} data-column={c.stage} className={`col ${over === c.stage && dragging ? 'drop-target' : ''}`}
            onDragOver={(e) => { if (dragging && canMove) { e.preventDefault(); setOver(c.stage); } }}
            onDragLeave={() => setOver((o) => (o === c.stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const l = p.stages.flatMap((s) => s.leads).find((x) => x.id === dragging);
              setDragging(null);
              if (l) void move(l, c.stage);
            }}>
            <div className="col-head">
              <span>{label(c.stage)}</span>
              <span className="muted">{c.leads.length}</span>
              <span style={{ flex: 1 }} />
              <span className="muted">{money0(c.leads.reduce((a, l) => a + (l.value || 0), 0), currency)}</span>
            </div>
            <div className="col-body">
              {c.leads.filter(match).map((l) => (
                <div key={l.id} className="kcard" draggable={canMove} onDragStart={() => setDragging(l.id)} onDragEnd={() => { setDragging(null); setOver(null); }} data-lead={l.title}>
                  <div className="t"><Link to={`/crm/leads/${l.id}`} onClick={(e) => e.stopPropagation()}>{l.title}</Link></div>
                  <div className="row tight small">
                    {l.value ? <b>{money0(l.value, currency)}</b> : <span className="muted">No value</span>}
                    {l.pieces ? <span className="muted">· {l.pieces} pcs</span> : null}
                    <Badge>{label(l.source)}</Badge>
                  </div>
                  <div className="muted small">{l.owner ? staffName(l.owner) : 'Unassigned'}{l.expected_close && ` · close ${day(l.expected_close)}`}</div>
                  {canMove && (
                    <select className="sm" value={l.stage} aria-label="Move to stage" data-testid="lead-move" onChange={(e) => void move(l, e.target.value)}>
                      {p.stages.map((s) => <option key={s.stage} value={s.stage}>{s.stage === l.stage ? `In ${label(s.stage)}` : `Move to ${label(s.stage)}`}</option>)}
                    </select>
                  )}
                </div>
              ))}
              {!c.leads.length && <div className="muted small" style={{ padding: 8 }}>No leads</div>}
            </div>
          </div>
        ))}
      </div>
      {creating && <LeadForm onClose={() => setCreating(false)} onSaved={(l) => nav(`/crm/leads/${l.id}`)} />}
    </>
  );
}
