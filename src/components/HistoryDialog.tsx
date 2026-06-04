/**
 * HistoryDialog — task (mission) history browser.
 * Fetches the latest missions from the DB, filters them client-side by AGV /
 * type / status / date / text, and exports the filtered set to CSV. Mirrors the
 * legacy RDS task-history table (filter + export) but kept lightweight.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Mission } from '@/types/fleet'
import { api, ApiError } from '@/services/api'

const STATUSES: Mission['status'][] = ['PENDING', 'ASSIGNED', 'EXECUTING', 'FINISHED', 'FAILED', 'CANCELLED']
const STATUS_COLOR: Record<Mission['status'], string> = {
  PENDING: 'var(--text-muted)', ASSIGNED: 'var(--accent)', EXECUTING: '#16a34a',
  FINISHED: '#15803d', FAILED: '#dc2626', CANCELLED: '#b45309',
}

// seconds between two ISO timestamps (started→finished), or null
function durationSec(m: Mission): number | null {
  if (!m.startedAt || !m.finishedAt) return null
  const d = (new Date(m.finishedAt).getTime() - new Date(m.startedAt).getTime()) / 1000
  return d >= 0 ? Math.round(d) : null
}
const fmtDur = (s: number | null) => s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
const fmtTs = (ts?: string | null) => ts ? new Date(ts).toLocaleString('en-GB') : '—'

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // filters
  const [status, setStatus] = useState('')
  const [agv, setAgv] = useState('')
  const [type, setType] = useState('')
  const [by, setBy] = useState('')      // operator who issued the command
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')   // yyyy-mm-dd
  const [to, setTo] = useState('')

  const load = () => {
    setLoading(true); setErr('')
    api.listMissions({ limit: 500 })
      .then(setRows)
      .catch(e => setErr(e instanceof ApiError ? e.message : 'failed to load history'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const agvIds = useMemo(() => [...new Set(rows.map(r => r.agvId).filter((x): x is string => !!x))].sort(), [rows])
  const types  = useMemo(() => [...new Set(rows.map(r => r.type))].sort(), [rows])
  const byList = useMemo(() => [...new Set(rows.map(r => r.createdBy).filter((x): x is string => !!x))].sort(), [rows])

  const filtered = useMemo(() => rows.filter(m => {
    if (status && m.status !== status) return false
    if (agv && m.agvId !== agv) return false
    if (type && m.type !== type) return false
    if (by && m.createdBy !== by) return false
    if (from && (!m.createdAt || m.createdAt.slice(0, 10) < from)) return false
    if (to && (!m.createdAt || m.createdAt.slice(0, 10) > to)) return false
    if (q) {
      const hay = `${m.missionNo} ${m.pickupStorageName ?? ''} ${m.dropoffStorageName ?? ''} ${m.startNode} ${m.endNode} ${m.agvId ?? ''} ${m.createdBy ?? ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, status, agv, type, by, q, from, to])

  const reset = () => { setStatus(''); setAgv(''); setType(''); setBy(''); setQ(''); setFrom(''); setTo('') }

  const exportCsv = () => {
    const cols = ['missionNo', 'type', 'status', 'priority', 'agvId', 'createdBy', 'pickup', 'dropoff', 'startNode', 'endNode', 'progress', 'durationSec', 'createdAt', 'startedAt', 'finishedAt']
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [cols.join(',')]
    for (const m of filtered) {
      lines.push([
        m.missionNo, m.type, m.status, m.priority, m.agvId ?? '', m.createdBy ?? '',
        m.pickupStorageName ?? '', m.dropoffStorageName ?? '', m.startNode, m.endNode,
        m.progress, durationSec(m) ?? '', m.createdAt, m.startedAt ?? '', m.finishedAt ?? '',
      ].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task-history-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div onClick={onClose} style={ovl}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'Roboto Mono', fontSize: 11, letterSpacing: 2, color: 'var(--accent)' }}>📋 TASK HISTORY</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{filtered.length} / {rows.length} record(s)</span>
          <button onClick={load} title="Reload" style={{ ...miniBtn, marginLeft: 8 }}>↻ RELOAD</button>
          <button onClick={exportCsv} disabled={!filtered.length}
            style={{ ...miniBtn, color: '#16a34a', border: '1px solid rgba(22,163,74,0.4)', background: 'rgba(22,163,74,0.08)', opacity: filtered.length ? 1 : 0.4 }}>⤓ EXPORT CSV</button>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        {/* filter bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <Field label="Search"><input value={q} onChange={e => setQ(e.target.value)} placeholder="mission / storage / node" style={{ ...inp, width: 180 }} /></Field>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, width: 110 }}>
              <option value="">All</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="AGV">
            <select value={agv} onChange={e => setAgv(e.target.value)} style={{ ...inp, width: 90 }}>
              <option value="">All</option>{agvIds.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select value={type} onChange={e => setType(e.target.value)} style={{ ...inp, width: 100 }}>
              <option value="">All</option>{types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="By">
            <select value={by} onChange={e => setBy(e.target.value)} style={{ ...inp, width: 120 }}>
              <option value="">All</option>{byList.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, width: 130 }} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, width: 130 }} /></Field>
          <button onClick={reset} style={{ ...miniBtn }}>CLEAR</button>
        </div>

        {/* table */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {err && <div style={{ padding: 14, fontSize: 11, color: '#dc2626' }}>{err}</div>}
          {loading && <div style={{ padding: 14, fontSize: 11, color: 'var(--text-faint)' }}>Loading…</div>}
          {!loading && !err && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, fontFamily: 'Roboto Mono' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'var(--bg)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  {['Mission', 'Type', 'Status', 'Prio', 'AGV', 'By', 'Pickup → Dropoff', 'Progress', 'Duration', 'Created'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid rgba(212,218,227,0.6)' }}>
                    <td style={{ padding: '5px 8px', color: 'var(--accent)' }}>{m.missionNo}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{m.type}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{ color: STATUS_COLOR[m.status], fontWeight: 700 }}>{m.status}</span>
                    </td>
                    <td style={{ padding: '5px 8px', color: m.priority <= 1 ? '#dc2626' : 'var(--text-muted)' }}>P{m.priority}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{m.agvId ?? '—'}</td>
                    <td style={{ padding: '5px 8px', color: m.createdBy ? 'var(--text-2)' : 'var(--text-faint)' }}>{m.createdBy ?? '—'}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{(m.pickupStorageName || m.startNode)} → {(m.dropoffStorageName || m.endNode)}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{m.progress}%</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{fmtDur(durationSec(m))}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{fmtTs(m.createdAt)}</td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={10} style={{ padding: 16, color: 'var(--text-faint)', textAlign: 'center' }}>No matching tasks</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 8, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
    {children}
  </div>
)

const ovl: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const panel: React.CSSProperties = { width: 'min(1000px, 94vw)', height: '86vh', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, "Noto Sans JP", sans-serif', color: 'var(--text)' }
const inp: React.CSSProperties = { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2, padding: '5px 7px', fontSize: 10, fontFamily: 'Roboto Mono', boxSizing: 'border-box' }
const miniBtn: React.CSSProperties = { fontSize: 9, padding: '4px 8px', borderRadius: 2, cursor: 'pointer', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent', fontFamily: 'Roboto Mono' }
