import React from 'react'
import Decimal from 'decimal.js'
import { X } from 'lucide-react'
import type { ApiQuickExpense } from './api'
import { EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORY } from './expense-categories'

type Input = Pick<ApiQuickExpense, 'name' | 'category' | 'amount' | 'expenseDate' | 'businessUnit' | 'notes' | 'paymentMethod'>
export function QuickExpenseModal({ close, save, defaultUnit }: { close: () => void; save: (id: string, input: Input) => Promise<void>; defaultUnit: Input['businessUnit'] }) {
  const now = new Date()
  const [expenseId] = React.useState(() => crypto.randomUUID())
  const [form, setForm] = React.useState<Input>({ name: '', category: DEFAULT_EXPENSE_CATEGORY, amount: '', expenseDate: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`, businessUnit: defaultUnit, notes: '', paymentMethod: 'cash' })
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await save(expenseId, { ...form, amount: new Decimal(form.amount).toFixed(2) }); close() }
    catch (error) { setError(error instanceof Error ? error.message : 'No se pudo guardar el gasto.') }
    finally { setSaving(false) }
  }
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Gasto nuevo">
    <button className="modal-backdrop" type="button" aria-label="Cerrar" onClick={close}/>
    <form className="event-modal compact-modal" onSubmit={event => void submit(event)}>
      <div className="modal-head"><div><p className="eyebrow">Gasto independiente</p><h2>Gasto nuevo</h2></div><button type="button" aria-label="Cerrar" onClick={close}><X size={20}/></button></div>
      <div className="form-grid">
        <label className="full">Nombre del gasto<input autoFocus required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
        <label>Categoría<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{EXPENSE_CATEGORIES.map(category=><option key={category}>{category}</option>)}</select></label>
        <label>Monto MXN<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })}/></label>
        <label>Fecha de pago<input required type="date" value={form.expenseDate} onChange={event => setForm({ ...form, expenseDate: event.target.value })}/></label>
        <label>Asignar a<select value={form.businessUnit} onChange={event => setForm({ ...form, businessUnit: event.target.value as Input['businessUnit'] })}><option value="SPL">SPL eventos propios</option><option value="5to Elemento">5to Elemento</option></select></label>
        <label>Forma de pago<select value={form.paymentMethod ?? 'cash'} onChange={event => setForm({ ...form, paymentMethod: event.target.value as Input['paymentMethod'] })}><option value="cash">Efectivo</option><option value="card">Tarjeta</option></select></label>
        <label className="full">Notas (opcional)<textarea maxLength={1000} rows={3} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })}/></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar gasto'}</button></div>
    </form>
  </div>
}
