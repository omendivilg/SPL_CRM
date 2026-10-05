import React from 'react'
import Decimal from 'decimal.js'
import { X } from 'lucide-react'
import type { ApiDirectIncome } from './api'

type IncomeInput = Pick<ApiDirectIncome, 'name' | 'amount' | 'businessUnit' | 'expectedDate' | 'receivedDate' | 'notes'>
const today = () => { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }

export function DirectIncomeModal({ close, save, defaultUnit }: { close: () => void; save: (id: string, input: IncomeInput) => Promise<void>; defaultUnit: IncomeInput['businessUnit'] }) {
  const [id] = React.useState(() => crypto.randomUUID())
  const [form, setForm] = React.useState<IncomeInput>({ name: '', amount: '', businessUnit: defaultUnit, expectedDate: today(), receivedDate: null, notes: '' })
  const [paid, setPaid] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await save(id, { ...form, amount: new Decimal(form.amount).toFixed(2), receivedDate: paid ? form.expectedDate : null, notes: form.notes?.trim() || null }); close() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la utilidad.') }
    finally { setSaving(false) }
  }
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Utilidad nueva">
    <button className="modal-backdrop" type="button" aria-label="Cerrar" onClick={close}/>
    <form className="event-modal compact-modal" onSubmit={event => void submit(event)}>
      <div className="modal-head"><div><p className="eyebrow">Cobro sin evento</p><h2>Utilidad nueva</h2></div><button type="button" aria-label="Cerrar" onClick={close}><X size={20}/></button></div>
      <p>Registra un ingreso directamente para SPL o 5to Elemento.</p>
      <div className="form-grid">
        <label className="full">Nombre de la utilidad<input autoFocus required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
        <label>Monto MXN<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })}/></label>
        <label>Compañía<select value={form.businessUnit} onChange={event => setForm({ ...form, businessUnit: event.target.value as IncomeInput['businessUnit'] })}><option value="SPL">SPL</option><option value="5to Elemento">5to Elemento</option></select></label>
        <label>{paid ? 'Fecha de cobro' : 'Fecha prevista'}<input required type="date" value={form.expectedDate} onChange={event => setForm({ ...form, expectedDate: event.target.value })}/></label>
        <label>Estado<select value={paid ? 'received' : 'pending'} onChange={event => setPaid(event.target.value === 'received')}><option value="pending">Pendiente</option><option value="received">Cobrada</option></select></label>
        <label className="full">Notas (opcional)<textarea maxLength={2000} rows={3} value={form.notes ?? ''} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Detalles de este ingreso"/></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar utilidad'}</button></div>
    </form>
  </div>
}
