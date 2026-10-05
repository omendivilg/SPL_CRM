import { expect, test } from '@playwright/test'
import ExcelJS from 'exceljs'

async function signIn(request: import('@playwright/test').APIRequestContext) {
  const response = await request.post('/api/auth/test-login')
  expect(response.ok()).toBe(true)
}

test('a direct utility persists through pending, received, and deleted states', async ({ request }) => {
  await signIn(request)
  const id = crypto.randomUUID()
  const url = `/api/direct-income/${id}`
  const created = await request.put(url, { data: {
    name: 'Renta de equipo sin evento', amount: '1250.50', businessUnit: '5to Elemento',
    expectedDate: '2026-09-22', receivedDate: null,
  } })
  expect(created.status()).toBe(201)
  expect((await created.json()).data).toMatchObject({ id, amount: '1250.50', receivedDate: null, version: 1 })

  const pending = await request.get('/api/direct-income')
  expect((await pending.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id, receivedDate: null })]))

  const received = await request.patch(`${url}/receive`, { data: { receivedDate: '2026-09-25', version: 1 } })
  expect(received.status()).toBe(200)
  expect((await received.json()).data).toMatchObject({ id, receivedDate: '2026-09-25', version: 2 })

  const duplicateReceipt = await request.patch(`${url}/receive`, { data: { receivedDate: '2026-09-26', version: 2 } })
  expect(duplicateReceipt.status()).toBe(409)
  const staleDelete = await request.delete(url, { data: { version: 1 } })
  expect(staleDelete.status()).toBe(409)
  const deleted = await request.delete(url, { data: { version: 2 } })
  expect(deleted.status()).toBe(200)
  const listed = await request.get('/api/direct-income')
  expect((await listed.json()).data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]))
})

test('a new standalone expense requires a selected payment method and preserves notes', async ({ request }) => {
  await signIn(request)
  const data = {
    name: 'Gasolina para almacén', category: 'Transporte', amount: '375.20',
    expenseDate: '2026-09-24', businessUnit: 'SPL', notes: 'Ruta al almacén',
  }
  const missing = await request.put(`/api/quick-expenses/${crypto.randomUUID()}`, { data })
  expect(missing.status()).toBe(400)
  const nullMethod = await request.put(`/api/quick-expenses/${crypto.randomUUID()}`, { data: { ...data, paymentMethod: null } })
  expect(nullMethod.status()).toBe(400)

  const id = crypto.randomUUID()
  const saved = await request.put(`/api/quick-expenses/${id}`, { data: { ...data, paymentMethod: 'card' } })
  expect(saved.status()).toBe(201)
  expect((await saved.json()).data).toMatchObject({ id, notes: 'Ruta al almacén', paymentMethod: 'card' })
  const listed = await request.get('/api/quick-expenses')
  expect((await listed.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id, notes: 'Ruta al almacén', paymentMethod: 'card' })]))
})

test('the utility user journey persists through the live API and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Entrar en modo de pruebas' }).click()
  const name = `Utilidad E2E ${crypto.randomUUID().slice(0, 8)}`
  await page.getByRole('button', { name: 'Utilidad nueva' }).click()
  const dialog = page.getByRole('dialog', { name: 'Utilidad nueva' })
  await dialog.getByLabel('Nombre de la utilidad').fill(name)
  await dialog.getByLabel('Monto MXN').fill('900.00')
  await dialog.getByLabel('Compañía').selectOption('5to Elemento')
  await dialog.getByLabel('Estado').selectOption('pending')
  const saveResponse = page.waitForResponse(response => response.url().includes('/api/direct-income/') && response.request().method() === 'PUT')
  await dialog.getByRole('button', { name: 'Guardar utilidad' }).click()
  const saved = (await (await saveResponse).json()).data
  expect(saved).toMatchObject({ name, businessUnit: '5to Elemento', amount: '900.00', receivedDate: null })

  await page.getByRole('button', { name: 'Finanzas' }).click()
  const row = page.locator('.finance-income-list > div').filter({ hasText: name })
  await expect(row).toContainText('Pendiente')
  await page.reload()
  await page.getByRole('button', { name: 'Finanzas' }).click()
  await expect(row).toContainText('Pendiente')

  await row.getByRole('button', { name: 'Marcar cobrada' }).click()
  const receiveResponse = page.waitForResponse(response => response.url().endsWith(`/api/direct-income/${saved.id}/receive`) && response.request().method() === 'PATCH')
  await page.getByRole('dialog', { name: 'Registrar cobro de utilidad' }).getByRole('button', { name: 'Registrar cobro' }).click()
  expect((await (await receiveResponse).json()).data.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await expect(row).toContainText('Cobrada')

  await row.getByRole('button', { name: `Eliminar utilidad ${name}` }).click()
  const deleteResponse = page.waitForResponse(response => response.url().endsWith(`/api/direct-income/${saved.id}`) && response.request().method() === 'DELETE')
  await page.getByRole('dialog', { name: 'Eliminar utilidad' }).getByRole('button', { name: 'Sí, eliminar utilidad' }).click()
  expect((await deleteResponse).status()).toBe(200)
  await expect(row).toHaveCount(0)
  const listed = await page.request.get('/api/direct-income')
  expect((await listed.json()).data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id })]))
})

test('a paid-by-default utility keeps its notes in the live API, reload, and monthly workbook', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T19:00:00Z'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Entrar en modo de pruebas' }).click()
  const name = `Cobro con notas ${crypto.randomUUID().slice(0, 8)}`
  const notes = 'Entrega en oficina\nComprobante de transferencia recibido'
  await page.getByRole('button', { name: 'Utilidad nueva' }).click()
  const dialog = page.getByRole('dialog', { name: 'Utilidad nueva' })
  await expect(dialog.getByLabel('Estado')).toHaveValue('received')
  await expect(dialog.getByLabel('Fecha de cobro')).toHaveValue('2026-09-30')
  await dialog.getByLabel('Nombre de la utilidad').fill(name)
  await dialog.getByLabel('Monto MXN').fill('876.54')
  await dialog.getByLabel('Compañía').selectOption('5to Elemento')
  await dialog.getByLabel('Notas (opcional)').fill(notes)
  const saveResponse = page.waitForResponse(response => response.url().includes('/api/direct-income/') && response.request().method() === 'PUT')
  await dialog.getByRole('button', { name: 'Guardar utilidad' }).click()
  const saved = (await (await saveResponse).json()).data
  expect(saved).toMatchObject({ name, businessUnit: '5to Elemento', amount: '876.54', expectedDate: '2026-09-30', receivedDate: '2026-09-30', notes })
  await page.getByRole('button', { name: 'Finanzas' }).click()
  const row = page.locator('.finance-income-list > div').filter({ hasText: name })
  await expect(row).toContainText('Cobrada')
  await expect(row).toContainText(notes)
  await expect(row.getByRole('button', { name: 'Marcar cobrada' })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Finanzas' }).click()
  await expect(row).toContainText(notes)
  const listed = await page.request.get('/api/direct-income')
  expect((await listed.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, notes, receivedDate: '2026-09-30' })]))
  const report = await page.request.get('/api/reports/monthly.xlsx?month=2026-09')
  expect(report.ok()).toBe(true)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await report.body())
  const utilities = workbook.getWorksheet('Utilidades')!
  const reportRow = utilities.getRows(1, utilities.rowCount)!.find(value => value.getCell(1).value === saved.id)
  expect(reportRow).toBeDefined()
  expect(reportRow!.getCell(8).value).toBe(notes)
  const deleted = await page.request.delete(`/api/direct-income/${saved.id}`, { data: { version: saved.version } })
  expect(deleted.ok()).toBe(true)
})
