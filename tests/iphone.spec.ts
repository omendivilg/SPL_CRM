import { expect, test as base, type Page, type Route } from '@playwright/test'

const test = base.extend<{ engine: 'chromium' | 'webkit' }>({
  engine: ['chromium', { option: true }],
  page: async ({ engine, playwright, baseURL }, use) => {
    const browser = await playwright[engine].launch({ channel: engine === 'chromium' ? 'chrome' : undefined })
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, hasTouch: true })
    try { await use(await context.newPage()) }
    finally { await context.close(); await browser.close() }
  },
})

// Browser-boundary regressions use disposable API fixtures, never Fly or Neon.
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'iphone@spl.test', displayName: 'Oscar QA', role: 'owner', unit: null }
const event = (index: number) => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, businessUnit: index % 2 ? 'SPL' : '5to Elemento', clientName: `Cliente ${index}`, venue: `Sede ${index}`, eventDate: '2026-09-30', operationalStatus: 'Confirmado', clientPhone: null, operationalNotes: null, financialNotes: null, agreedPrice: '1000.00', payrollBudget: '0.00', extraExpenseBudget: '0.00', version: 1 })

async function fixture(page: Page, options: { coordinator?: boolean; count?: number; failList?: boolean } = {}) {
  const state = { events: Array.from({ length: options.count ?? 3 }, (_, index) => event(index + 1)), failList: options.failList ?? false, failMovements: false, reads: 0 }
  const expenses = [{ id: 'expense-large', name: 'Pago de prueba', category: 'Transporte', expenseDate: '2026-09-29', amount: '123456789.99', businessUnit: 'SPL', notes: '', paymentMethod: 'cash', createdAt: '2026-09-29T12:00:00Z', createdBy: user.id }]
  await page.clock.setFixedTime(new Date('2026-10-05T19:00:00Z'))
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const respond = (data: unknown, status = 200) => route.fulfill({ status, json: { data } })
    if (path === '/api/auth/me') return respond(options.coordinator ? { ...user, role: 'coordinator', unit: '5to Elemento' } : user)
    if (path === '/api/events' && method === 'GET') {
      state.reads++
      if (state.failList) return route.fulfill({ status: 503, json: { error: 'isolated unavailable fixture' } })
      return respond(options.coordinator ? state.events.filter(item => item.businessUnit === '5to Elemento').map(({ agreedPrice, ...rest }) => rest) : state.events)
    }
    if (/^\/api\/events\/[^/]+$/.test(path) && method === 'DELETE') {
      const id = path.split('/')[3]
      state.events = state.events.filter(item => item.id !== id)
      return respond({ id })
    }
    if (/^\/api\/events\/[^/]+\/(expenses|payments)$/.test(path) && method === 'GET' && state.failMovements) return route.fulfill({ status: 503, json: { error: 'isolated movement failure' } })
    if (path === '/api/quick-expenses' && method === 'GET') return respond(expenses)
    if (path.startsWith('/api/quick-expenses/') && method === 'PUT') {
      const created = { ...request.postDataJSON(), id: path.split('/')[3], createdAt: '2026-10-05T19:00:00Z', createdBy: user.id }
      expenses.push(created)
      return respond(created, 201)
    }
    if (path === '/api/direct-income') return respond([{ id: 'income-test', businessUnit: 'SPL', name: 'Ingreso de prueba', amount: '100.00', expectedDate: '2026-09-29', receivedDate: '2026-09-29', version: 1, createdAt: '2026-09-29T12:00:00Z', createdBy: user.id }])
    if (path === '/api/weekly-payroll/legacy') return respond({ entries: [], settlements: [] })
    if (method === 'GET') return respond([])
    throw new Error(`Unhandled isolated fixture: ${method} ${path}`)
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: options.coordinator ? 'Eventos' : 'Buen día, Oscar', exact: true })).toBeVisible()
  await expect.poll(() => state.reads).toBeGreaterThan(0)
  return state
}

async function navigate(page: Page, name: string) {
  if (await page.locator('.menu-button').isVisible()) await page.locator('.menu-button').click()
  await page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click()
}

async function scope(page: Page, value: string) {
  if (await page.locator('.menu-button').isVisible()) await page.locator('.menu-button').click()
  await page.getByLabel('Vista de negocio').selectOption(value)
  if (await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) await page.locator('.mobile-close').click()
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'page must not scroll horizontally').toBe(true)
}

async function chartAtEnd(page: Page) {
  const chart = page.locator('.weekly-chart-scroll')
  await expect.poll(() => chart.evaluate(element => Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThanOrEqual(2)
}

for (const browser of ['chromium', 'webkit'] as const) {
  test.describe(`${browser} iPhone`, () => {
    test.use({ engine: browser })

    for (const width of [320, 375, 393, 430]) {
      test(`${width}px dialogs, latest weekly cards, dates and event navigation fit`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 852 })
        await fixture(page)
        const chartGeometry = () => page.locator('.weekly-chart-scroll').evaluate(element => ({ left: element.scrollLeft, width: element.clientWidth, total: element.scrollWidth, svg: element.querySelector('svg')?.getBoundingClientRect().width }))
        await testInfo.attach('chart before dialogs', { body: JSON.stringify(await chartGeometry()), contentType: 'application/json' })
        for (const name of ['Utilidad nueva', 'Gasto nuevo']) {
          await page.getByRole('button', { name, exact: true }).click()
          const dialog = page.getByRole('dialog', { name, exact: true })
          await expect(dialog).toBeVisible()
          expect(await dialog.evaluate(element => element.contains(document.activeElement) && !document.activeElement?.matches('input,textarea,select')), `${name} opens with non-editable focus`).toBe(true)
          expect(await dialog.locator('input,textarea,select').evaluateAll(elements => elements.every(element => parseFloat(getComputedStyle(element).fontSize) >= 16)), 'avoid iPhone focus zoom').toBe(true)
          await dialog.getByRole('textbox').first().click()
          await expect(dialog.getByRole('textbox').first()).toBeFocused()
          await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
        }
        await testInfo.attach('chart after dialogs', { body: JSON.stringify(await chartGeometry()), contentType: 'application/json' })
        await chartAtEnd(page)
        if (width === 393) await page.locator('.weekly-chart-scroll').screenshot({ path: `outputs/iphone-chart-${browser}-${width}.png` })
        const cards = page.locator('.weekly-cards')
        await expect(cards).toBeVisible()
        await expect(cards.locator('article')).toHaveCount(8)
        await expect(cards.locator('article').first()).toContainText(/29 sep.*5 oct/)
        await expect(cards.locator('article').last()).toContainText(/11 ago.*17 ago/)
        for (const label of ['Entradas', 'Reembolsos', 'Cobros netos', 'Gastos', 'Nómina', 'Ganancia']) await expect(cards.locator('article').first()).toContainText(label)
        await expect(cards.locator('article').first()).toContainText('-$123,456,689.99')
        await expect(cards.locator('article').last()).toContainText('$0.00')
        expect(await cards.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        expect(await cards.locator('article').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
        await cards.locator('article').first().screenshot({ path: testInfo.outputPath(`weekly-${browser}-${width}.png`) })
        await navigate(page, 'Eventos')
        await expect(page.locator('.event-table-row')).toHaveCount(3)
        await expect(page.locator('.event-detail')).not.toBeVisible()
        await expect(page.locator('.event-table-row').first()).not.toContainText(event(1).id)
        await page.locator('.event-table-row').first().click()
        await expect(page.locator('.event-detail')).toBeVisible()
        await expect(page.locator('.event-table-panel')).not.toBeVisible()
        await noPageOverflow(page)
        await page.screenshot({ path: testInfo.outputPath(`events-${browser}-${width}.png`), fullPage: true })
        await page.getByRole('button', { name: 'Volver a eventos', exact: true }).click()
        await expect(page.locator('.event-table-row')).toHaveCount(3)
        await navigate(page, 'Nómina')
        await page.getByRole('button', { name: 'Nueva nómina', exact: true }).click()
        const start = page.getByLabel('Inicio', { exact: true }), end = page.getByLabel('Fin', { exact: true })
        const a = (await start.boundingBox())!, b = (await end.boundingBox())!
        expect(Math.abs(a.width - b.width), 'equal date widths').toBeLessThanOrEqual(2)
        if (width < 360) expect(b.y).toBeGreaterThan(a.y + a.height)
        else {
          expect(Math.abs(a.y - b.y), 'same date row').toBeLessThanOrEqual(2)
          expect(b.x).toBeGreaterThan(a.x + a.width)
        }
        for (const input of [start, end]) {
          expect(await input.evaluate(element => getComputedStyle(element).textAlign)).toBe('center')
          expect(await input.evaluate(element => getComputedStyle(element.parentElement!).textAlign)).toBe('center')
        }
        await noPageOverflow(page)
        await page.screenshot({ path: testInfo.outputPath(`payroll-${browser}-${width}.png`), fullPage: true })
      })
    }

    test('chart remembers user slide during interaction and updates, resets for range or company', async ({ page }) => {
      await page.setViewportSize({ width: 393, height: 852 })
      await fixture(page)
      const chart = page.locator('.weekly-chart-scroll')
      await chartAtEnd(page)
      await chart.evaluate(element => { element.scrollLeft = 0 })
      await chart.getByRole('img', { name: /11 ago.*Entradas/ }).click()
      expect(await chart.evaluate(element => element.scrollLeft)).toBe(0)
      await page.getByRole('button', { name: 'Gasto nuevo', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Gasto nuevo' })
      await dialog.getByLabel('Nombre del gasto').fill('Cambio sin reiniciar gráfica')
      await dialog.getByLabel('Monto MXN').fill('12')
      await dialog.getByRole('button', { name: 'Guardar gasto' }).click()
      await expect(dialog).not.toBeVisible()
      expect(await chart.evaluate(element => element.scrollLeft)).toBe(0)
      await page.getByRole('button', { name: 'Ver ocho semanas anteriores' }).click()
      await chartAtEnd(page)
      await chart.evaluate(element => { element.scrollLeft = 0 })
      await scope(page, '5to Elemento')
      await chartAtEnd(page)
      await chart.evaluate(element => { element.scrollLeft = 0 })
      await page.getByRole('button', { name: 'Periodo anterior' }).click()
      await chartAtEnd(page)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Buen día, Oscar' })).toBeVisible()
      await chartAtEnd(page)
    })

    test('event list keeps scroll and company, recovers missing selection, deletes and retries', async ({ page }) => {
      await page.setViewportSize({ width: 393, height: 852 })
      const state = await fixture(page, { count: 30 })
      await navigate(page, 'Eventos')
      await scope(page, 'SPL')
      const chosen = page.locator(`[data-event-id="${event(21).id}"]`)
      await chosen.scrollIntoViewIfNeeded()
      const position = await page.evaluate(() => window.scrollY)
      expect(position).toBeGreaterThan(0)
      state.failMovements = true
      await chosen.click()
      await expect(page.getByRole('alert')).toContainText('No pudimos actualizar los movimientos del evento')
      await expect(page.getByRole('button', { name: 'Volver a eventos' })).toBeVisible()
      state.failMovements = false
      await page.getByRole('alert').getByRole('button', { name: 'Reintentar' }).click()
      await expect(page.getByRole('alert')).not.toBeVisible()
      await page.getByRole('button', { name: 'Volver a eventos' }).click()
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(position - 3)
      await expect(page.getByLabel('Vista de negocio')).toHaveValue('SPL')
      await chosen.click()
      await scope(page, '5to Elemento')
      await expect(page.locator('.event-detail')).not.toBeVisible()
      await expect(page.locator('.event-table-row')).toHaveCount(15)
      await page.locator('.event-table-row').first().click()
      await page.getByRole('button', { name: 'Eliminar evento', exact: true }).click()
      await page.getByRole('button', { name: 'Sí, eliminar evento' }).click()
      await expect(page.locator('.event-table-row')).toHaveCount(14)
      await expect(page.locator('.event-detail')).not.toBeVisible()
      state.failList = true
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Buen día, Oscar', exact: true })).toBeVisible()
      await navigate(page, 'Eventos')
      await expect(page.getByRole('alert')).toContainText('No pudimos cargar los eventos')
      state.failList = false
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
      await expect(page.locator('.event-table-row')).toHaveCount(14)
      await noPageOverflow(page)
    })
  })
}

test('landscape and desktop event workspace fits and desktop retains input autofocus', async ({ page }) => {
  await fixture(page)
  for (const width of [852, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await navigate(page, 'Eventos')
    await expect(page.locator('.event-detail')).toBeVisible()
    await expect(page.locator('.event-table-panel')).toBeVisible()
    await noPageOverflow(page)
  }
  for (const name of ['Gasto nuevo', 'Utilidad nueva']) {
    await page.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog.getByRole('textbox').first()).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  }
})

test('coordinator phone events keep financial controls hidden', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await fixture(page, { coordinator: true })
  await expect(page.locator('.event-detail')).not.toBeVisible()
  await page.locator('.event-table-row').first().click()
  await expect(page.locator('.event-detail')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar precio acordado' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Registrar abono' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Eliminar evento' })).toHaveCount(0)
  await expect(page.getByLabel('Vista de negocio')).toBeDisabled()
  await noPageOverflow(page)
})
