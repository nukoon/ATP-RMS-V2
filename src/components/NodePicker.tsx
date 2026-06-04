/**
 * NodePicker — typeable node combobox with a THEMED dropdown. Native
 * <datalist>/<select> popups render an off-theme black box, so we draw our own
 * filtered list. Used wherever an operator picks an LM/AP node by id.
 */
import { useState } from 'react'

export function NodePicker({ value, onChange, nodeIds, placeholder, style }: {
  value: string
  onChange: (v: string) => void
  nodeIds: string[]
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const matches = nodeIds.filter(id => id.toUpperCase().includes(value.toUpperCase())).slice(0, 12)
  const inp: React.CSSProperties = {
    background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2,
    padding: '4px 6px', fontSize: 10, fontFamily: 'Roboto Mono', width: '100%', boxSizing: 'border-box', ...style,
  }
  return (
    <div style={{ position: 'relative' }}>
      <input value={value} placeholder={placeholder} style={inp}
        onChange={e => { onChange(e.target.value.toUpperCase()); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 2, maxHeight: 150, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, boxShadow: '0 6px 18px rgba(0,0,0,0.3)' }}>
          {matches.map(id => (
            <button key={id} type="button" onMouseDown={() => { onChange(id); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', fontSize: 10, fontFamily: 'Roboto Mono',
                cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{id}</button>
          ))}
        </div>
      )}
    </div>
  )
}
