import { expect, test, type Page, type Route } from '@playwright/test'

const initialEvent = {id:'11111111-1111-4111-8111-111111111111',businessUnit:'SPL',clientName:'Cliente inicial',clientPhone:null,venue:'Hacienda San José',eventDate:'2026-09-18',operationalStatus:'Confirmado',operationalNotes:null,financialNotes:null,agreedPrice:'125000.00',payrollBudget:'30000.00',extraExpenseBudget:'30000.00',version:1}

const owner={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'owner@spl.mx',displayName:'Oscar Méndez',role:'owner',unit:null}
const coordinator={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',userId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'coord@spl.mx',displayName:'Coordinación SPL',role:'coordinator',unit:'5to Elemento'}

test('a delayed prior session cannot replace the current user events',async({page})=>{
  await mockApi(page,{testLogin:true})
  const held:Route[]=[]
  let secondSession=false
  await page.route('**/api/events',async route=>{
    if(!secondSession){held.push(route);return}
    await route.fulfill({status:200,json:{data:[{...initialEvent,venue:'Salón usuario B'}]}})
  })
  await page.route('**/api/auth/test-login',async route=>{
    secondSession=true
    await route.fulfill({status:200,json:{data:{...owner,userId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',displayName:'Usuario B'}}})
  })
  await page.goto('/')
  await expect.poll(()=>held.length).toBeGreaterThan(0)
  await page.getByRole('button',{name:/Cerrar sesión/}).click()
  await page.getByRole('button',{name:'Entrar en modo de pruebas'}).click()
  await page.getByRole('button',{name:'Eventos',exact:true}).click()
  await expect(page.locator('main')).toContainText('Salón usuario B')
  await Promise.all(held.map(route=>route.fulfill({status:200,json:{data:[{...initialEvent,venue:'Salón usuario A'}]}})))
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main')).toContainText('Salón usuario B')
  await expect(page.locator('main')).not.toContainText('Salón usuario A')
})

async function mockApi(page:Page, options:{failFirstList?:boolean;user?:typeof owner;requireLogin?:boolean;testLogin?:boolean;events?:Array<typeof initialEvent>;payments?:any[];expenses?:any[];expenseSettlements?:any[];payroll?:any[];weekly?:any[];legacySettlements?:any[]}={}) {
  const events=options.events??[initialEvent]; let listAttempts=0
  const payments:any[]=options.payments??[];const expenses:any[]=options.expenses??[];const payroll:any[]=options.payroll??[];const workers:any[]=[];const templates:any[]=[];const quickExpenses:any[]=[];const directIncomes:any[]=[]
  let authenticated=!options.requireLogin
  await page.route('**/api/**',async(route:Route)=>{
    const request=route.request(),url=new URL(request.url()),method=request.method()
    if(url.pathname==='/api/auth/me'&&method==='GET')return route.fulfill(authenticated?{status:200,json:{data:options.user??owner}}:{status:401,json:{error:'unauthorized'}})
    if(url.pathname==='/api/auth/login'&&method==='POST'){authenticated=true;return route.fulfill({status:200,json:{data:options.user??owner}})}
    if(url.pathname==='/api/auth/google'&&method==='POST'){authenticated=true;return route.fulfill({status:200,json:{data:{...owner,role:'admin'}}})}
    if(url.pathname==='/api/auth/test-login/config'&&method==='GET')return route.fulfill({status:200,json:{data:{enabled:options.testLogin===true}}})
    if(url.pathname==='/api/auth/test-login'&&method==='POST'){authenticated=true;return route.fulfill({status:200,json:{data:{...owner,role:'admin'}}})}
    if(url.pathname==='/api/auth/logout'&&method==='POST'){authenticated=false;return route.fulfill({status:204})}
    if(url.pathname==='/api/reports/monthly.xlsx'&&method==='GET')return route.fulfill({status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:Buffer.from('PK mock workbook')})
    if(url.pathname==='/api/workers'&&method==='GET')return route.fulfill({status:200,json:{data:workers}})
    if(url.pathname==='/api/workers'&&method==='POST'){const body=request.postDataJSON(),created={id:'99999999-9999-4999-8999-999999999999',name:body.name,active:true};workers.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname==='/api/payroll-templates'&&method==='GET')return route.fulfill({status:200,json:{data:templates}})
    if(url.pathname==='/api/payroll-templates'&&method==='POST'){const body=request.postDataJSON(),created={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',...body};templates.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname.startsWith('/api/payroll-templates/')&&method==='PUT'){const body=request.postDataJSON(),index=templates.findIndex(item=>url.pathname.endsWith(item.id)),updated={id:templates[index].id,...body};templates[index]=updated;return route.fulfill({status:200,json:{data:updated}})}
    if(url.pathname==='/api/payroll'&&method==='GET')return route.fulfill({status:200,json:{data:payroll}})
    if(url.pathname==='/api/weekly-payroll'&&method==='GET')return route.fulfill({status:200,json:{data:options.weekly??[]}})
    if(url.pathname==='/api/quick-expenses'&&method==='GET')return route.fulfill({status:200,json:{data:quickExpenses}})
    if(url.pathname.startsWith('/api/quick-expenses/')&&method==='PUT'){const id=url.pathname.split('/').at(-1),prior=quickExpenses.find(item=>item.id===id);if(prior)return route.fulfill({status:201,json:{data:prior}});const created={...request.postDataJSON(),id,createdAt:new Date().toISOString(),createdBy:'owner'};quickExpenses.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname==='/api/direct-income'&&method==='GET')return route.fulfill({status:200,json:{data:directIncomes.filter(item=>!item.deletedAt)}})
    if(/^\/api\/direct-income\/[^/]+$/.test(url.pathname)&&method==='PUT'){const id=url.pathname.split('/').at(-1),prior=directIncomes.find(item=>item.id===id);if(prior)return route.fulfill({status:201,json:{data:prior}});const body=request.postDataJSON(),created={...body,id,amount:Number(body.amount).toFixed(2),receivedDate:body.receivedDate??null,version:1,createdAt:new Date().toISOString(),createdBy:'owner'};directIncomes.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(/^\/api\/direct-income\/[^/]+\/receive$/.test(url.pathname)&&method==='PATCH'){const id=url.pathname.split('/')[3],income=directIncomes.find(item=>item.id===id&&!item.deletedAt);if(!income)return route.fulfill({status:404,json:{error:'missing'}});const body=request.postDataJSON();if(body.version!==income.version)return route.fulfill({status:409,json:{error:'conflict'}});income.receivedDate=body.receivedDate;income.version++;return route.fulfill({status:200,json:{data:income}})}
    if(/^\/api\/direct-income\/[^/]+$/.test(url.pathname)&&method==='DELETE'){const id=url.pathname.split('/').at(-1),income=directIncomes.find(item=>item.id===id&&!item.deletedAt);if(!income)return route.fulfill({status:404,json:{error:'missing'}});const body=request.postDataJSON();if(body.version!==income.version)return route.fulfill({status:409,json:{error:'conflict'}});income.deletedAt=new Date().toISOString();income.version++;return route.fulfill({status:200,json:{data:income}})}
    if(url.pathname==='/api/expense-settlements'&&method==='GET')return route.fulfill({status:200,json:{data:options.expenseSettlements??[]}})
    if(url.pathname==='/api/weekly-payroll/legacy'&&method==='GET')return route.fulfill({status:200,json:{data:{entries:[],settlements:options.legacySettlements??[]}}})
    if(url.pathname==='/api/payroll'&&method==='POST'){const body=request.postDataJSON(),laborCost=(Number(body.baseCost)+Number(body.additions)).toFixed(2),netPay=(Number(laborCost)-Number(body.deductions)).toFixed(2),created={...body,id:'77777777-7777-4777-8777-777777777777',laborCost,netPay,allocationTotal:laborCost,paidAmount:'0.00',outstandingAmount:netPay};payroll.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(/^\/api\/payroll\/[^/]+\/settlements$/.test(url.pathname)&&method==='POST'){const body=request.postDataJSON(),entry=payroll.find(item=>url.pathname.includes(item.id));if(!entry)return route.fulfill({status:404,json:{error:'missing'}});entry.paidAmount=(Number(entry.paidAmount)+Number(body.amount)).toFixed(2);entry.outstandingAmount=(Number(entry.netPay)-Number(entry.paidAmount)).toFixed(2);return route.fulfill({status:201,json:{data:{...body,id:'88888888-8888-4888-8888-888888888888',payrollEntryId:entry.id,paidAmount:entry.paidAmount,outstandingAmount:entry.outstandingAmount,createdAt:new Date().toISOString()}}})}
    if(url.pathname==='/api/events'&&method==='GET'){
      listAttempts++
      if(options.failFirstList&&listAttempts<=2)return route.fulfill({status:503,json:{error:'temporary'}})
      return route.fulfill({status:200,json:{data:events}})
    }
    if(url.pathname==='/api/events'&&method==='POST'){
      const body=request.postDataJSON(); const created={...body,id:'33333333-3333-4333-8333-333333333333',version:1};events.unshift(created);return route.fulfill({status:201,json:{data:created}})
    }
    if(/^\/api\/events\/[^/]+\/price$/.test(url.pathname)&&method==='PATCH'){const body=request.postDataJSON();const event=events.find(item=>url.pathname.includes(item.id))!;event.agreedPrice=body.agreedPrice;event.version++;return route.fulfill({status:200,json:{data:event}})}
    if(/^\/api\/events\/[^/]+$/.test(url.pathname)&&method==='DELETE'){const index=events.findIndex(item=>url.pathname.endsWith(item.id));if(index<0)return route.fulfill({status:404,json:{error:'missing'}});const [removed]=events.splice(index,1);return route.fulfill({status:200,json:{data:{id:removed.id}}})}
    if(/^\/api\/events\/[^/]+\/budget$/.test(url.pathname)&&method==='PATCH'){const body=request.postDataJSON();initialEvent.payrollBudget=body.payrollBudget;return route.fulfill({status:200,json:{data:initialEvent}})}
    if(url.pathname.endsWith('/expenses')&&method==='GET')return route.fulfill({status:200,json:{data:expenses.filter(item=>url.pathname.includes(item.eventId))}})
    if(url.pathname.endsWith('/expenses')&&method==='POST'){const body=request.postDataJSON();const created={...body,id:'44444444-4444-4444-8444-444444444444',eventId:initialEvent.id,paidAmount:'0.00',version:1};expenses.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname.endsWith('/payments')&&method==='GET')return route.fulfill({status:200,json:{data:payments.filter(item=>url.pathname.includes(item.eventId))}})
    if(url.pathname.endsWith('/payments')&&method==='POST'){const body=request.postDataJSON();const prior=payments.find(item=>item.idempotencyKey===body.idempotencyKey);const created=prior??{...body,id:`55555555-5555-4555-8555-${String(payments.length+1).padStart(12,'0')}`,eventId:events.find(item=>url.pathname.includes(item.id))?.id,createdAt:new Date().toISOString()};if(!prior)payments.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname.endsWith('/pay-remaining')&&method==='POST'){const body=request.postDataJSON(),event=events.find(item=>url.pathname.includes(item.id))!,paid=payments.filter(item=>item.eventId===event.id).reduce((sum,item)=>sum+(item.kind==='refund'?-Number(item.amount):Number(item.amount)),0),created={...body,id:'77777777-7777-4777-8777-777777777777',eventId:event.id,amount:(Number(event.agreedPrice)-paid).toFixed(2),kind:'payment',version:1,createdAt:new Date().toISOString()};payments.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(/^\/api\/payments\/[^/]+$/.test(url.pathname)&&method==='DELETE'){const index=payments.findIndex(item=>url.pathname.endsWith(item.id));if(index<0)return route.fulfill({status:404,json:{error:'missing'}});const [removed]=payments.splice(index,1);return route.fulfill({status:200,json:{data:{id:removed.id}}})}
    if(url.pathname.includes('/api/expenses/')&&url.pathname.endsWith('/settlements')&&method==='POST'){const body=request.postDataJSON(),expense=expenses.find(item=>url.pathname.includes(item.id));if(!expense)return route.fulfill({status:404,json:{error:'missing'}});expense.paidAmount=(Number(expense.paidAmount)+Number(body.amount)).toFixed(2);return route.fulfill({status:201,json:{data:{...body,id:'66666666-6666-4666-8666-666666666666',expenseId:expense.id,paidAmount:expense.paidAmount,createdAt:new Date().toISOString()}}})}
    return route.fulfill({status:404,json:{error:'not found'}})
  })
}

test('saves a standalone expense for weekly tracking', async ({ page }) => {
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Gasto nuevo'}).click()
  const dialog=page.getByRole('dialog',{name:'Gasto nuevo'})
  await dialog.getByLabel('Nombre del gasto').fill('Gasolina de prueba')
  await dialog.getByLabel('Categoría').selectOption('Transporte')
  await dialog.getByLabel('Monto MXN').fill('125.50')
  await dialog.getByLabel('Fecha de pago').fill(today)
  await dialog.getByLabel('Asignar a').selectOption('SPL')
  await dialog.getByLabel('Forma de pago').selectOption('card')
  await dialog.getByLabel('Notas (opcional)').fill('Traslado al almacén')
  await dialog.getByRole('button',{name:'Guardar gasto'}).click()
  await expect(page.getByText('Gasolina de prueba')).toBeVisible()
  await page.getByRole('button',{name:'Finanzas'}).click()
  const detail=page.getByRole('region',{name:'Detalle de gastos'})
  await expect(detail).toContainText('Gasolina de prueba')
  await expect(detail).toContainText('Traslado al almacén')
  await expect(detail).toContainText('Tarjeta')
  await expect(page.getByRole('img',{name:'Gastos por categoría, pagados y pendientes'})).toContainText('$125.50 pagados')
  await page.reload()
  await page.getByRole('button',{name:'Finanzas'}).click()
  await expect(page.getByRole('region',{name:'Detalle de gastos'})).toContainText('Gasolina de prueba')
})

test('utility moves from receivable to cash only when it is collected and can be deleted',async({page})=>{
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  await mockApi(page,{events:[]})
  await page.goto('/')
  await page.getByRole('button',{name:'Utilidad nueva'}).click()
  const create=page.getByRole('dialog',{name:'Utilidad nueva'})
  await create.getByLabel('Nombre de la utilidad').fill('Renta adicional')
  await create.getByLabel('Monto MXN').fill('1200')
  await create.getByLabel('Compañía').selectOption('SPL')
  await create.getByLabel('Estado').selectOption('pending')
  await create.getByLabel('Fecha prevista').fill(today)
  await create.getByRole('button',{name:'Guardar utilidad'}).click()
  await expect(page.locator('.metric-card').filter({hasText:'Saldo por cobrar'})).toContainText('$1,200.00')
  await expect(page.locator('.metric-card').filter({hasText:'Cobros registrados'})).toContainText('$0.00')
  await page.getByRole('button',{name:'Finanzas'}).click()
  await expect(page.locator('.finance-metrics').getByText('Por cobrar').locator('..')).toContainText('$1,200.00')
  const row=page.locator('.finance-income-list > div').filter({hasText:'Renta adicional'})
  await expect(row).toContainText('Pendiente')
  await row.getByRole('button',{name:'Marcar cobrada'}).click()
  await page.getByRole('dialog',{name:'Registrar cobro de utilidad'}).getByLabel('Fecha real de cobro').fill(today)
  await page.getByRole('dialog',{name:'Registrar cobro de utilidad'}).getByRole('button',{name:'Registrar cobro'}).click()
  await expect(row).toContainText('Cobrada')
  await expect(page.locator('.finance-metrics').getByText('Por cobrar').locator('..')).toContainText('$0.00')
  await page.getByRole('button',{name:'Panel general'}).click()
  await expect(page.locator('.metric-card').filter({hasText:'Cobros registrados'})).toContainText('$1,200.00')
  await expect(page.getByRole('region',{name:'Gastos y ganancias por semana'}).locator('tbody')).toContainText('$1,200.00')
  await page.getByRole('button',{name:'Finanzas'}).click()
  await row.getByRole('button',{name:'Eliminar utilidad Renta adicional'}).click()
  await page.getByRole('dialog',{name:'Eliminar utilidad'}).getByRole('button',{name:'Sí, eliminar utilidad'}).click()
  await expect(row).toHaveCount(0)
  await page.getByRole('button',{name:'Panel general'}).click()
  await expect(page.locator('.metric-card').filter({hasText:'Cobros registrados'})).toContainText('$0.00')
})

test('business view persists across pages and reload and sets the next form company',async({page})=>{
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const fifth={...initialEvent,id:'22222222-2222-4222-8222-222222222222',businessUnit:'5to Elemento',clientName:'Cliente quinto',venue:'Salón Quinto',eventDate:today}
  await mockApi(page,{events:[initialEvent,fifth]})
  await page.goto('/')
  const scope=page.getByLabel('Vista de negocio')
  await scope.selectOption('5to Elemento')
  await expect(page.locator('.brand-logo')).toHaveAttribute('src','/quinto-elemento-logo.png')
  await page.getByRole('button',{name:'Eventos'}).click()
  await expect(page.locator('.event-table-row')).toHaveCount(1)
  await expect(page.getByText('Cliente quinto').first()).toBeVisible()
  await page.getByRole('button',{name:'Nuevo evento'}).first().click()
  await expect(page.getByLabel('Unidad')).toHaveValue('5to Elemento')
  await page.getByRole('button',{name:'Cancelar'}).click()
  await page.getByRole('button',{name:'Gasto nuevo'}).click()
  await expect(page.getByRole('dialog',{name:'Gasto nuevo'}).getByLabel('Asignar a')).toHaveValue('5to Elemento')
  await page.getByRole('dialog',{name:'Gasto nuevo'}).getByRole('button',{name:'Cancelar'}).click()
  await page.getByRole('button',{name:'Utilidad nueva'}).click()
  await expect(page.getByRole('dialog',{name:'Utilidad nueva'}).getByLabel('Compañía')).toHaveValue('5to Elemento')
  await page.getByRole('dialog',{name:'Utilidad nueva'}).getByRole('button',{name:'Cancelar'}).click()
  await page.getByRole('button',{name:'Finanzas'}).click()
  await expect(page.locator('.finance-table tbody tr')).toHaveCount(1)
  await page.reload()
  await expect(scope).toHaveValue('5to Elemento')
  await expect(page.locator('.brand-logo')).toHaveAttribute('src','/quinto-elemento-logo.png')
  await scope.selectOption('Todos')
  await expect(page.locator('.brand-logo')).toHaveAttribute('src','/spl-logo.png')
  await page.getByRole('button',{name:'Nuevo evento'}).first().click()
  await expect(page.getByLabel('Unidad')).toHaveValue('SPL')
})

test('dashboard restores the exact selected week after work elsewhere and reload',async({page})=>{
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Periodo anterior'}).click()
  const week=await page.locator('.dashboard-period-nav strong').textContent()
  await page.getByRole('button',{name:'Eventos'}).click()
  await page.getByRole('button',{name:'Finanzas'}).click()
  await page.getByRole('button',{name:'Panel general'}).click()
  await expect(page.locator('.dashboard-period-nav strong')).toHaveText(week??'')
  await page.reload()
  await expect(page.locator('.dashboard-period-nav strong')).toHaveText(week??'')
})

test('new finance surfaces fit desktop, tablet, and phone widths',async({page},testInfo)=>{
  await mockApi(page,{events:[]})
  await page.goto('/')
  await page.getByLabel('Vista de negocio').selectOption('5to Elemento')
  await page.getByRole('button',{name:'Utilidad nueva'}).click()
  const income=page.getByRole('dialog',{name:'Utilidad nueva'})
  await income.getByLabel('Nombre de la utilidad').fill('Servicio adicional')
  await income.getByLabel('Monto MXN').fill('3400')
  await income.getByRole('button',{name:'Guardar utilidad'}).click()
  await page.getByRole('button',{name:'Gasto nuevo'}).click()
  const expense=page.getByRole('dialog',{name:'Gasto nuevo'})
  await expense.getByLabel('Nombre del gasto').fill('Transporte directo')
  await expense.getByLabel('Monto MXN').fill('250')
  await expense.getByLabel('Notas (opcional)').fill('Traslado a la sede')
  await expense.getByRole('button',{name:'Guardar gasto'}).click()
  await page.getByRole('button',{name:'Finanzas'}).click()
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['phone',390,844]] as const){
    await page.setViewportSize({width,height})
    await expect(page.getByRole('heading',{name:'Finanzas'})).toBeVisible()
    await expect(page.getByRole('region',{name:'Detalle de gastos'})).toContainText('Transporte directo')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),name).toBe(true)
    await page.screenshot({path:testInfo.outputPath(`finance-${name}.png`),fullPage:true})
    if(name!=='desktop'){
      await page.locator('.menu-button').click()
      await expect(page.getByLabel('Vista de negocio')).toHaveValue('5to Elemento')
      await expect(page.locator('.brand-logo')).toHaveAttribute('src','/quinto-elemento-logo.png')
      await page.screenshot({path:testInfo.outputPath(`menu-${name}.png`)})
      await page.locator('.mobile-close').click()
      await page.waitForFunction(()=>{const sidebar=document.querySelector('.sidebar');return sidebar!==null&&sidebar.getBoundingClientRect().right<=0})
    }
    if(name==='phone'){
      await page.locator('.menu-button').click()
      await page.getByRole('button',{name:'Panel general'}).click()
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'dashboard phone').toBe(true)
      await page.screenshot({path:testInfo.outputPath('dashboard-phone.png'),fullPage:true})
    }
  }
})

test('creates an API-backed pending-price event and keeps it after reload', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByRole('heading', { name: 'Eventos' })).toBeVisible()
  await page.getByRole('button', { name: 'Nuevo evento' }).first().click()
  await page.getByLabel('Cliente').fill('Cliente de prueba')
  await page.getByLabel('Lugar').fill('Salón del Valle')
  await page.getByLabel('Fecha').fill('2026-11-07')
  await expect(page.getByLabel('Presupuesto de nómina')).toHaveCount(0)
  await expect(page.getByLabel('Presupuesto de gastos extra')).toHaveCount(0)
  await page.getByRole('button', { name: 'Crear evento' }).click()
  await expect(page.getByText('Evento · Salón del Valle').first()).toBeVisible()
  await expect(page.getByText('Precio pendiente').first()).toBeVisible()
  await page.screenshot({path:'../outputs/spl-api-connected-events.png',fullPage:true})
  await page.reload()
  await page.getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByText('Evento · Salón del Valle').first()).toBeVisible()
})

test('shows a recoverable connection error and retries safely',async({page})=>{
  await mockApi(page,{failFirstList:true})
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar los eventos')
  await page.getByRole('button',{name:'Reintentar'}).click()
  await expect(page.getByText('Evento · Hacienda San José').first()).toBeVisible()
})

test('renders hostile server text as text instead of executable markup',async({page})=>{
  let attacked=false
  await page.exposeFunction('recordAttack',()=>{attacked=true})
  await mockApi(page)
  await page.route('**/api/events',route=>route.fulfill({status:200,json:{data:[{...initialEvent,venue:'<img src=x onerror=recordAttack()>'}]}}))
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await expect(page.getByText('Evento · <img src=x onerror=recordAttack()>').first()).toBeVisible()
  expect(attacked).toBe(false)
})

test('signs in without exposing a specific account failure',async({page})=>{
  await mockApi(page,{requireLogin:true})
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Bienvenido'})).toBeVisible()
  await page.getByLabel('Correo electrónico').fill('owner@spl.mx')
  await page.getByLabel('Contraseña').fill('una-clave-segura')
  await page.getByRole('button',{name:'Iniciar sesión'}).click()
  await expect(page.getByRole('heading',{name:'Buen día, Oscar'})).toBeVisible()
})

test('keeps financial controls hidden from coordinators',async({page})=>{
  await mockApi(page,{user:coordinator,events:[{...initialEvent,businessUnit:'5to Elemento'}]})
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Eventos'})).toBeVisible()
  await expect(page.getByText('La información financiera está protegida para este perfil.')).toBeVisible()
  await expect(page.getByRole('button',{name:'Panel general'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Finanzas'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Exportar mes'})).toHaveCount(0)
  await expect(page.getByText('Precio acordado')).toHaveCount(0)
  await page.getByRole('button',{name:'Nuevo evento'}).first().click()
  await expect(page.getByLabel('Unidad')).toBeDisabled()
  await expect(page.getByLabel('Unidad')).toHaveValue('5to Elemento')
  await expect(page.getByLabel('Presupuesto de nómina')).toHaveCount(0)
  await page.screenshot({path:'../outputs/spl-coordinator-access.png',fullPage:true})
})

test.skip('creates the administrator session through the rendered Google button',async({page})=>{
  await mockApi(page,{requireLogin:true})
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(options){window.googleCallback=options.callback},renderButton(element){const button=document.createElement('button');button.textContent='Continuar con Google';button.onclick=()=>window.googleCallback({credential:'signed-google-token'});element.appendChild(button)}}}}`}))
  await page.goto('/')
  await page.getByRole('button',{name:'Continuar con Google'}).click()
  await expect(page.getByRole('heading',{name:'Buen día, Oscar'})).toBeVisible()
})

test('enters the application through local test mode without Google',async({page})=>{
  await mockApi(page,{requireLogin:true,testLogin:true})
  await page.goto('/')
  await page.getByRole('button',{name:'Entrar en modo de pruebas'}).click()
  await expect(page.getByRole('heading',{name:'Buen día, Oscar'})).toBeVisible()
})

test('records a customer payment and shows the reconciled balance',async({page})=>{
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await page.getByRole('button',{name:'Registrar abono'}).click()
  await page.getByRole('dialog',{name:'Registrar abono'}).getByLabel('Monto MXN').fill('25000')
  await page.getByRole('button',{name:'Guardar abono'}).click()
  await expect(page.getByText('+$25,000.00')).toBeVisible()
  await expect(page.getByText('$100,000.00').first()).toBeVisible()
  await page.screenshot({path:'../outputs/spl-payment-workflow.png',fullPage:true})
})

test('dashboard orders future events and shows only unpaid event balances',async({page})=>{
  const past={...initialEvent,id:'11111111-1111-4111-8111-111111111112',venue:'Pasado',clientName:'Cliente pasado',eventDate:'2000-01-01',agreedPrice:'500.00',operationalStatus:'Pendiente'}
  const paid={...initialEvent,id:'11111111-1111-4111-8111-111111111113',venue:'Pagado próximo',clientName:'Cliente pagado',eventDate:'2098-01-01',agreedPrice:'900.00',operationalStatus:'Pendiente'}
  const sooner={...initialEvent,id:'11111111-1111-4111-8111-111111111114',venue:'Próximo primero',clientName:'Cliente primero',eventDate:'2099-03-01',agreedPrice:'1000.00',operationalStatus:'Pendiente'}
  const later={...initialEvent,id:'11111111-1111-4111-8111-111111111115',venue:'Próximo después',clientName:'Cliente después',eventDate:'2099-06-01',agreedPrice:'2000.00',operationalStatus:'Pendiente'}
  await mockApi(page,{events:[later,past,sooner,paid],payments:[{id:'55555555-5555-4555-8555-555555555558',eventId:paid.id,transactionDate:'2097-12-01',amount:'900.00',kind:'payment',version:1}]})
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Flujo de efectivo'})).toHaveCount(0)
  const upcoming=page.locator('.events-panel .event-row')
  await expect(upcoming).toHaveCount(3)
  await expect(upcoming.nth(0)).toContainText('Pagado próximo')
  await expect(upcoming.nth(1)).toContainText('Próximo primero')
  await expect(upcoming.nth(2)).toContainText('Próximo después')
  await expect(upcoming.nth(0).locator('.status')).toHaveText('Pagado')
  await expect(upcoming.nth(0).locator('.status')).toHaveClass(/confirmed/)
  const debts=page.locator('.budget-panel .alert-item')
  await expect(debts).toHaveCount(3)
  await expect(debts.nth(0)).toContainText('Cliente pasado')
  await expect(debts.nth(0)).toContainText('$500.00')
  await expect(debts.nth(1)).toContainText('$1,000.00')
  await expect(debts.nth(2)).toContainText('$2,000.00')
  await expect(page.locator('.budget-panel')).not.toContainText('Cliente pagado')
  await page.screenshot({path:'../outputs/spl-dashboard-receivables.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect.poll(async()=>{const box=await page.locator('.sidebar').boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true)
  await expect(upcoming.nth(0).locator('.status')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({path:'../outputs/spl-dashboard-receivables-mobile.png',fullPage:true})
})

test('dashboard itemizes costs and reconciles weekly expenses with profit',async({page})=>{
  const now=new Date()
  const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const event={...initialEvent,eventDate:date,agreedPrice:'1000.00'}
  const expenses=[
    {id:'a',eventId:event.id,name:'Audio principal',category:'Renta de equipo',expenseDate:date,amount:'200.00',paidAmount:'200.00'},
    {id:'b',eventId:event.id,name:'Flete',category:'Transporte',expenseDate:date,amount:'50.00',paidAmount:'50.00'},
  ]
  const payroll=[
    {id:'labor-event',employeeName:'Andrea',periodStart:date,periodEnd:date,baseCost:'100.00',additions:'0.00',deductions:'10.00',laborCost:'100.00',netPay:'90.00',paidAmount:'90.00',allocations:[{scope:'event',eventId:event.id,amount:'100.00'}]},
    {id:'labor-warehouse',employeeName:'Luis',periodStart:date,periodEnd:date,baseCost:'75.00',additions:'0.00',deductions:'0.00',laborCost:'75.00',netPay:'75.00',paidAmount:'75.00',allocations:[{scope:'warehouse',eventId:null,amount:'75.00'}]},
  ]
  const weekly=[{id:'batch',name:'Festival septiembre',businessUnit:'SPL',status:'paid',periodEnd:date,payments:[{paymentDate:date,amount:'190.00'}],lines:[{id:'labor-event'},{id:'labor-warehouse'}],expenses:[{id:'food',concept:'Alimentos',scope:'warehouse',eventId:null,amount:'25.00'}]}]
  await mockApi(page,{events:[event],payments:[{id:'payment',eventId:event.id,transactionDate:date,amount:'600.00',kind:'payment'}],expenses,expenseSettlements:[{expenseId:'a',paymentDate:date,amount:'200.00'},{expenseId:'b',paymentDate:date,amount:'50.00'}],payroll,weekly})
  await page.goto('/')
  const panel=page.getByRole('region',{name:'Gasto por categoría'})
  await expect(panel).toContainText('Audio principal')
  await expect(panel).toContainText('Renta de equipo')
  await expect(panel).toContainText('Flete')
  await expect(panel).toContainText('Alimentos')
  await expect(panel.locator('.dashboard-cost-detail')).not.toContainText('Andrea')
  await expect(panel.locator('.dashboard-cost-detail')).not.toContainText('Luis')
  await expect(panel.locator('.dashboard-cost-detail h3')).toContainText('3')
  await expect(panel.locator('.donut')).toContainText('$440.00')
  const chart=page.getByRole('region',{name:'Gastos y ganancias por semana'})
  await expect(chart.locator('.weekly-legend').getByText('Nómina', {exact:true})).toBeVisible()
  await expect(chart.locator('tbody tr').last()).toContainText('$600.00')
  await expect(chart.locator('tbody tr').last()).toContainText('$440.00')
  await expect(chart.locator('tbody tr').last()).toContainText('$190.00')
  await expect(chart.locator('tbody tr').last()).toContainText('$160.00')
  expect((await chart.locator('.weekly-payroll-bar').last().boundingBox())?.height).toBeGreaterThan(0)
  await page.getByLabel('Vista de negocio').selectOption('SPL')
  await expect(panel.locator('.donut')).toContainText('$440.00')
  await expect(panel).toContainText('Nómina de almacén')
  await expect(chart.locator('tbody tr').last()).toContainText('$190.00')
  await expect(chart.locator('tbody tr').last()).toContainText('$160.00')
  await page.getByRole('button',{name:'Ver ocho semanas anteriores'}).click()
  await expect(chart.locator('tbody')).not.toContainText('$160.00')
  await page.getByRole('button',{name:'Ver ocho semanas siguientes'}).click()
  await expect(chart.locator('tbody tr').last()).toContainText('$160.00')
  await page.screenshot({path:'../outputs/spl-dashboard-costs-weekly-desktop.png',fullPage:true})
  await page.setViewportSize({width:820,height:1180})
  await expect.poll(async()=>{const box=await page.locator('.sidebar').boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({path:'../outputs/spl-dashboard-costs-weekly-ipad.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect.poll(async()=>{const box=await page.locator('.sidebar').boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({path:'../outputs/spl-dashboard-costs-weekly-mobile.png',fullPage:true})
  await page.locator('.menu-button').click()
  await page.getByRole('button',{name:'Finanzas'}).click()
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0)
  const monitoring=page.getByRole('region',{name:'Trabajadores por nómina'})
  await expect(monitoring.locator('tbody tr')).toHaveCount(2)
  await expect(monitoring).toContainText('Festival septiembre')
  await expect(monitoring).toContainText('Andrea')
  await expect(monitoring).toContainText('Luis')
  await expect(monitoring).toContainText('$90.00')
  await expect(monitoring.locator('td[data-label="Neto"]').first()).toBeVisible()
  await monitoring.getByRole('searchbox',{name:'Buscar trabajador o nómina'}).fill('Andrea')
  await expect(monitoring.locator('tbody tr')).toHaveCount(1)
  await expect(monitoring.locator('tbody tr')).toContainText('Andrea')
  await expect.poll(async()=>{const box=await page.locator('.sidebar').boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true)
  await page.evaluate(()=>window.scrollTo(0,0))
  await page.screenshot({path:'../outputs/spl-finance-payroll-monitor-mobile.png',fullPage:true})
})

test('expense detail keeps amounts clear of its dark scrollbar',async({page})=>{
  const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const expenses=Array.from({length:12},(_,index)=>({id:`expense-${index}`,eventId:initialEvent.id,name:`Gasto ${index+1}`,category:'Otros gastos',expenseDate:date,amount:'10.00',paidAmount:'10.00'}))
  await mockApi(page,{expenses,expenseSettlements:expenses.map(expense=>({expenseId:expense.id,paymentDate:date,amount:'10.00'}))})
  await page.goto('/')
  const detail=page.locator('.dashboard-cost-rows')
  await expect(detail.locator('.dashboard-cost-row')).toHaveCount(12)
  const layout=await detail.evaluate(element=>({scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,padding:getComputedStyle(element).paddingRight,color:getComputedStyle(element).scrollbarColor}))
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
  expect(layout.padding).toBe('14px')
  expect(layout.color).not.toBe('auto')
  await page.screenshot({path:'../outputs/spl-dashboard-expense-scrollbar.png',fullPage:true})
})

test('legacy payroll outstanding follows the company of each allocation at period close',async({page},testInfo)=>{
  await page.clock.setFixedTime(new Date('2026-09-30T19:00:00Z'))
  const date='2026-09-30',event={...initialEvent,businessUnit:'5to Elemento',eventDate:date,agreedPrice:'100.00'}
  const line={id:'legacy-split-payroll',employeeName:'Trabajador histórico',periodStart:'2026-09-29',periodEnd:'2026-10-05',baseCost:'100.00',additions:'0.00',deductions:'10.00',laborCost:'100.00',netPay:'90.00',paidAmount:'45.00',outstandingAmount:'45.00',allocations:[{scope:'event',eventId:event.id,amount:'60.00'},{scope:'warehouse',eventId:null,amount:'40.00'}]}
  await mockApi(page,{events:[event],payroll:[line],legacySettlements:[{id:'legacy-pay',payrollEntryId:line.id,amount:'45.00',paymentDate:date}]})
  await page.goto('/')
  await page.getByRole('button',{name:'Finanzas',exact:true}).click()
  const payable=page.locator('.finance-metrics').getByText('Por pagar',{exact:true}).locator('..')
  for(const [scope,amount] of [['5to Elemento','$27.00'],['SPL','$18.00'],['Todos','$45.00']] as const){
    await page.getByLabel('Vista de negocio').selectOption(scope)
    await expect(payable).toContainText(amount)
    await page.screenshot({path:testInfo.outputPath(`legacy-payroll-${scope==='5to Elemento'?'fifth':scope.toLowerCase()}.png`),fullPage:true})
  }
})

test('payroll cash allocations preserve a 99.99 payment without inventing a cent',async({page},testInfo)=>{
  await page.clock.setFixedTime(new Date('2026-09-30T19:00:00Z'))
  const date='2026-09-30',first={...initialEvent,eventDate:date,agreedPrice:'0.00'},second={...initialEvent,id:'22222222-2222-4222-8222-222222222222',venue:'Otro evento de reparto',eventDate:date,agreedPrice:'0.00'}
  const line={id:'legacy-cent-payroll',employeeName:'Trabajador de redondeo',periodStart:'2026-09-29',periodEnd:'2026-10-05',baseCost:'100.00',additions:'0.00',deductions:'0.01',laborCost:'100.00',netPay:'99.99',paidAmount:'99.99',outstandingAmount:'0.00',allocations:[{scope:'event',eventId:first.id,amount:'33.33'},{scope:'event',eventId:second.id,amount:'33.33'},{scope:'warehouse',eventId:null,amount:'33.34'}]}
  await mockApi(page,{events:[first,second],payroll:[line],legacySettlements:[{id:'legacy-cent-pay',payrollEntryId:line.id,amount:'99.99',paymentDate:date}]})
  await page.goto('/')
  await expect(page.locator('.metric-card').filter({hasText:'Gastos pagados'})).toContainText('$99.99')
  const weekly=page.getByRole('region',{name:'Gastos y ganancias por semana'})
  await expect(weekly.locator('tbody tr').last().locator('td[data-label="Gastos"]')).toHaveText('$99.99')
  await page.getByRole('button',{name:'Finanzas',exact:true}).click()
  await expect(page.locator('.finance-cash-result')).toContainText('menos pagos $99.99')
  await expect(page.locator('.finance-metrics').getByText('Por pagar',{exact:true}).locator('..')).toContainText('$0.00')
  await page.screenshot({path:testInfo.outputPath('legacy-payroll-cent.png'),fullPage:true})
})

test('pays the remaining event balance, removes abonos and can remove the price and event',async({page})=>{
  await mockApi(page,{events:[{...initialEvent,operationalStatus:'Pendiente'}]})
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await expect(page.locator('.event-detail .status')).toHaveText('Pendiente')
  await page.getByRole('button',{name:'Registrar abono'}).click()
  await page.getByRole('dialog',{name:'Registrar abono'}).getByLabel('Monto MXN').fill('25000')
  await page.getByRole('button',{name:'Guardar abono'}).click()
  await expect(page.locator('.event-detail .status')).toHaveText('Pendiente')
  await page.getByRole('button',{name:'Pago completo'}).click()
  await page.getByRole('dialog',{name:'Registrar pago del saldo'}).getByRole('button',{name:'Confirmar pago completo'}).click()
  await expect(page.locator('.event-detail .detail-money').getByText('$0.00')).toBeVisible()
  await expect(page.locator('.event-detail .status')).toHaveText('Pagado')
  await expect(page.locator('.event-table-row .status')).toHaveText('Pagado')
  await page.getByRole('button',{name:'Panel general'}).click()
  await expect(page.locator('.budget-panel .alert-item')).toHaveCount(0)
  await page.getByRole('button',{name:'Eventos'}).click()
  await page.getByRole('button',{name:/Quitar abono del/}).first().click()
  await page.getByRole('button',{name:'Confirmar',exact:true}).click()
  await expect(page.getByText('+$25,000.00')).toHaveCount(0)
  await expect(page.locator('.event-detail .status')).toHaveText('Pendiente')
  await page.getByRole('button',{name:'Editar precio acordado'}).click()
  await page.getByRole('dialog',{name:'Editar precio acordado'}).getByRole('button',{name:'Quitar precio acordado'}).click()
  await expect(page.locator('.event-detail').getByText('Precio pendiente')).toBeVisible()
  await page.getByRole('button',{name:'Eliminar evento'}).click()
  await page.getByRole('button',{name:'Sí, eliminar evento'}).click()
  await expect(page.getByText('No hay eventos en esta vista')).toBeVisible()
})

test('paid event remains until its deletion is confirmed',async({page})=>{
  await mockApi(page,{events:[{...initialEvent,agreedPrice:'100.00',operationalStatus:'Pendiente'}]})
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await page.getByRole('button',{name:'Pago completo'}).click()
  await page.getByRole('dialog',{name:'Registrar pago del saldo'}).getByRole('button',{name:'Confirmar pago completo'}).click()
  await expect(page.locator('.event-detail .status')).toHaveText('Pagado')
  await page.getByRole('button',{name:'Eliminar evento'}).click()
  await expect(page.getByRole('group',{name:'Confirmar eliminación del evento'})).toBeVisible()
  await page.getByRole('group',{name:'Confirmar eliminación del evento'}).getByRole('button',{name:'Cancelar'}).click()
  await expect(page.locator('.event-table-row')).toHaveCount(1)
  await page.getByRole('button',{name:'Eliminar evento'}).click()
  await page.getByRole('button',{name:'Sí, eliminar evento'}).click()
  await expect(page.getByText('No hay eventos en esta vista')).toBeVisible()
})

test('dashboard period selector follows the actual payment date',async({page})=>{
  const today='2026-09-30'
  await page.clock.setFixedTime(new Date('2026-09-30T19:00:00Z'))
  const event={...initialEvent,eventDate:today,agreedPrice:'100.00'}
  await mockApi(page,{events:[event],payments:[{id:'payment-current',eventId:event.id,transactionDate:today,amount:'100.00',kind:'payment'}]})
  await page.goto('/')
  const receipts=page.locator('.metric-card').filter({hasText:'Cobros registrados'})
  await expect(receipts).toContainText('$100.00')
  await expect(page.getByRole('button',{name:'Semana',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button',{name:'Periodo anterior'}).click()
  await expect(receipts).toContainText('$0.00')
  await page.getByRole('button',{name:'Periodo siguiente'}).click()
  await page.getByRole('button',{name:'Mes',exact:true}).click()
  await expect(receipts).toContainText('$100.00')
  await page.locator('.weekly-expense-point').first().focus()
  const tooltip=page.locator('.weekly-chart-scroll .weekly-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Gastos')
  await expect(tooltip).toContainText('$0.00')
  await expect(tooltip).not.toContainText('Cobros')
  await page.locator('.weekly-profit-point').last().hover()
  await expect(tooltip).toContainText('Ganancia')
  await expect(tooltip).toContainText('$100.00')
  await expect(tooltip).not.toContainText('Nómina')
  await page.locator('.weekly-expense-point').first().hover()
  await expect(tooltip).toContainText('Gastos $0.00')
  await page.screenshot({path:'../outputs/spl-weekly-tooltip-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.waitForFunction(() => document.querySelector('.sidebar')?.getBoundingClientRect().right === 0)
  await page.locator('.weekly-profit-point').first().focus()
  await page.locator('.weekly-expense-point').first().focus()
  await expect(tooltip).toContainText('Gastos $0.00')
  await page.getByRole('region',{name:'Gastos y ganancias por semana'}).screenshot({path:'../outputs/spl-weekly-tooltip-mobile.png'})
})

test('shows Pagado when separate abonos cover the agreed event price',async({page})=>{
  await mockApi(page,{events:[{...initialEvent,agreedPrice:'100.00',operationalStatus:'Pendiente'}]})
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  for(const amount of ['40','60']){
    await page.getByRole('button',{name:'Registrar abono'}).click()
    await page.getByRole('dialog',{name:'Registrar abono'}).getByLabel('Monto MXN').fill(amount)
    await page.getByRole('button',{name:'Guardar abono'}).click()
  }
  await expect(page.locator('.event-detail .status')).toHaveText('Pagado')
  await expect(page.locator('.event-detail .status')).toHaveClass(/confirmed/)
  await page.getByRole('button',{name:'Panel general'}).click()
  await expect(page.locator('.budget-panel .alert-item')).toHaveCount(0)
})

test('creates a named expense and marks only its full balance as paid',async({page})=>{
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  await page.getByRole('button',{name:'Agregar'}).click()
  const dialog=page.getByRole('dialog',{name:'Agregar gasto extra'})
  await dialog.getByLabel('Nombre del gasto').fill('Transporte adicional')
  await dialog.getByLabel('Monto MXN').fill('1000')
  await dialog.getByRole('button',{name:'Guardar'}).click()
  await expect(page.getByText('Transporte adicional')).toBeVisible()
  await page.getByRole('button',{name:'Marcar como pagado'}).click()
  await expect(page.getByText('Pagado',{exact:true})).toBeVisible()
})

test('shows actual event costs without obsolete budget controls',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Eventos'}).click();await expect(page.getByText('Gasto total del evento')).toBeVisible();await expect(page.getByRole('button',{name:'Modificar presupuesto'})).toHaveCount(0);await expect(page.getByText('Presupuesto $30,000.00')).toHaveCount(0)})




test('downloads the selected monthly Excel report',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Exportar mes'}).click();await page.getByRole('dialog',{name:'Exportar reporte mensual'}).getByLabel('Mes del reporte').fill('2026-09');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar Excel'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('SPL-reporte-2026-09.xlsx')})

test('shows reconciled finance and editable settings pages',async({page})=>{
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  await mockApi(page,{events:[{...initialEvent,eventDate:today}]})
  await page.goto('/')
  await page.getByRole('button',{name:'Finanzas'}).click()
  await expect(page.getByRole('heading',{name:'Finanzas'})).toBeVisible()
  await expect(page.locator('.finance-metrics')).not.toContainText('Cobros netos')
  await expect(page.locator('.finance-summary .finance-total')).toContainText('Resultado previsto')
  await expect(page.getByRole('heading',{name:'Detalle por evento'})).toBeVisible()
  await expect(page.getByText('Cliente inicial').first()).toBeVisible()
  await page.screenshot({path:'../outputs/spl-finance-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Configuración'}).click()
  await expect(page.getByRole('heading',{name:'Configuración'})).toBeVisible()
  await expect(page.getByText('owner@spl.mx')).toBeVisible()
  await page.getByLabel('Unidad predeterminada').selectOption('5to Elemento')
  await page.getByRole('button',{name:'Guardar cambios'}).click()
  await expect(page.getByRole('button',{name:'Guardado'})).toBeVisible()
  await page.screenshot({path:'../outputs/spl-settings-desktop.png',fullPage:true})
})


test('keeps finance navigation usable at iPad width',async({page})=>{await page.setViewportSize({width:820,height:1180});await mockApi(page);await page.goto('/');const sidebar=page.locator('.sidebar'),closedBox=await sidebar.boundingBox();expect(closedBox&&closedBox.x+closedBox.width<=0).toBe(true);await page.locator('.menu-button').click();await expect(sidebar).toHaveClass(/open/);await page.getByRole('button',{name:'Finanzas'}).click();await expect(page.getByRole('heading',{name:'Finanzas'})).toBeVisible();await expect.poll(async()=>{const box=await sidebar.boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.screenshot({path:'../outputs/spl-finance-ipad.png',fullPage:true})})
