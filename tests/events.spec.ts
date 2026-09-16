import { expect, test, type Page, type Route } from '@playwright/test'

const initialEvent = {id:'11111111-1111-4111-8111-111111111111',businessUnit:'SPL',clientName:'Cliente inicial',clientPhone:null,venue:'Hacienda San José',eventDate:'2026-09-18',operationalStatus:'Confirmado',operationalNotes:null,financialNotes:null,agreedPrice:'125000.00',payrollBudget:'30000.00',extraExpenseBudget:'30000.00',version:1}

const owner={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'owner@spl.mx',displayName:'Oscar Méndez',role:'owner'}
const coordinator={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'coord@spl.mx',displayName:'Coordinación SPL',role:'coordinator'}

async function mockApi(page:Page, options:{failFirstList?:boolean;user?:typeof owner;requireLogin?:boolean}={}) {
  const events=[initialEvent]; let listAttempts=0
  const payments:any[]=[];const expenses:any[]=[];const payroll:any[]=[]
  let authenticated=!options.requireLogin
  await page.route('**/api/**',async(route:Route)=>{
    const request=route.request(),url=new URL(request.url()),method=request.method()
    if(url.pathname==='/api/auth/me'&&method==='GET')return route.fulfill(authenticated?{status:200,json:{data:options.user??owner}}:{status:401,json:{error:'unauthorized'}})
    if(url.pathname==='/api/auth/login'&&method==='POST'){authenticated=true;return route.fulfill({status:200,json:{data:options.user??owner}})}
    if(url.pathname==='/api/auth/google'&&method==='POST'){authenticated=true;return route.fulfill({status:200,json:{data:{...owner,role:'admin'}}})}
    if(url.pathname==='/api/auth/logout'&&method==='POST'){authenticated=false;return route.fulfill({status:204})}
    if(url.pathname==='/api/reports/monthly.xlsx'&&method==='GET')return route.fulfill({status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:Buffer.from('PK mock workbook')})
    if(url.pathname==='/api/payroll'&&method==='GET')return route.fulfill({status:200,json:{data:payroll}})
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
    if(url.pathname.endsWith('/expenses')&&method==='GET')return route.fulfill({status:200,json:{data:expenses}})
    if(url.pathname.endsWith('/expenses')&&method==='POST'){const body=request.postDataJSON();const created={...body,id:'44444444-4444-4444-8444-444444444444',eventId:initialEvent.id,paidAmount:'0.00',version:1};expenses.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname.endsWith('/payments')&&method==='GET')return route.fulfill({status:200,json:{data:payments}})
    if(url.pathname.endsWith('/payments')&&method==='POST'){const body=request.postDataJSON();const prior=payments.find(item=>item.idempotencyKey===body.idempotencyKey);const created=prior??{...body,id:'55555555-5555-4555-8555-555555555555',eventId:initialEvent.id,createdAt:new Date().toISOString()};if(!prior)payments.push(created);return route.fulfill({status:201,json:{data:created}})}
    if(url.pathname.includes('/api/expenses/')&&url.pathname.endsWith('/settlements')&&method==='POST'){const body=request.postDataJSON(),expense=expenses.find(item=>url.pathname.includes(item.id));if(!expense)return route.fulfill({status:404,json:{error:'missing'}});expense.paidAmount=(Number(expense.paidAmount)+Number(body.amount)).toFixed(2);return route.fulfill({status:201,json:{data:{...body,id:'66666666-6666-4666-8666-666666666666',expenseId:expense.id,paidAmount:expense.paidAmount,createdAt:new Date().toISOString()}}})}
    return route.fulfill({status:404,json:{error:'not found'}})
  })
}

test('creates an API-backed pending-price event and keeps it after reload', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByRole('heading', { name: 'Eventos' })).toBeVisible()
  await page.getByRole('button', { name: 'Nuevo evento' }).first().click()
  await page.getByLabel('Cliente').fill('Cliente de prueba')
  await page.getByLabel('Lugar').fill('Salón del Valle')
  await page.getByLabel('Fecha').fill('2026-11-07')
  await page.getByLabel('Presupuesto de nómina').fill('15000')
  await page.getByLabel('Presupuesto de gastos extra').fill('8000')
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
  await mockApi(page,{user:coordinator})
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

test('creates the administrator session through the rendered Google button',async({page})=>{
  await mockApi(page,{requireLogin:true})
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(options){window.googleCallback=options.callback},renderButton(element){const button=document.createElement('button');button.textContent='Continuar con Google';button.onclick=()=>window.googleCallback({credential:'signed-google-token'});element.appendChild(button)}}}}`}))
  await page.goto('/')
  await page.getByRole('button',{name:'Continuar con Google'}).click()
  await expect(page.getByRole('heading',{name:'Buen día, Oscar'})).toBeVisible()
})

test('records a customer payment and shows the reconciled balance',async({page})=>{
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  page.once('dialog',dialog=>dialog.accept('25000'))
  await page.getByRole('button',{name:'Registrar abono'}).click()
  await expect(page.getByText('+$25,000.00')).toBeVisible()
  await expect(page.getByText('$100,000.00').first()).toBeVisible()
  await page.screenshot({path:'../outputs/spl-payment-workflow.png',fullPage:true})
})

test('creates and partially settles a named expense without exceeding its total',async({page})=>{
  await mockApi(page)
  await page.goto('/')
  await page.getByRole('button',{name:'Eventos'}).click()
  const answers=['Transporte adicional','1000','400']
  page.on('dialog',dialog=>dialog.accept(answers.shift()??''))
  await page.getByRole('button',{name:'Agregar'}).click()
  await expect(page.getByText('Transporte adicional')).toBeVisible()
  await page.getByRole('button',{name:'Registrar pago'}).click()
  await expect(page.getByText('Pendiente $600.00')).toBeVisible()
})

test('reconciles a payroll record, its allocation and a partial payment',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Nómina'}).click();await page.getByLabel('Empleado').fill('Andrea López');await page.getByLabel('Inicio').fill('2026-09-01');await page.getByLabel('Fin').fill('2026-09-15');await page.getByLabel('Costo base').fill('1000.10');await page.getByLabel('Adiciones').fill('200.20');await page.getByLabel('Deducciones').fill('50.05');await page.getByLabel('Monto 1').fill('1200.30');await page.getByRole('button',{name:'Guardar nómina'}).click();await expect(page.getByText('Andrea López')).toBeVisible();await expect(page.getByText('$1,200.30')).toBeVisible();await expect(page.getByText('$1,150.25',{exact:true})).toBeVisible();page.once('dialog',dialog=>dialog.accept('500.25'));await page.getByRole('button',{name:'Registrar pago'}).click();await expect(page.getByText('Pendiente $650.00')).toBeVisible();await page.screenshot({path:'../outputs/spl-payroll-workflow.png',fullPage:true})})

test('allocates one payroll cost across warehouse and event work',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Nómina'}).click();await page.getByLabel('Empleado').fill('Luis Torres');await page.getByLabel('Inicio').fill('2026-09-01');await page.getByLabel('Fin').fill('2026-09-15');await page.getByLabel('Costo base').fill('1200');await page.getByLabel('Monto 1').fill('400');await page.getByRole('button',{name:'Agregar asignación'}).click();await page.getByLabel('Destino 2').selectOption(initialEvent.id);await page.getByLabel('Monto 2').fill('800');await page.getByRole('button',{name:'Guardar nómina'}).click();await expect(page.getByText('Luis Torres')).toBeVisible();await expect(page.getByText('$1,200.00').first()).toBeVisible()})

test('downloads the selected monthly Excel report',async({page})=>{await mockApi(page);await page.goto('/');page.once('dialog',dialog=>dialog.accept('2026-09'));const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar mes'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('SPL-reporte-2026-09.xlsx')})
