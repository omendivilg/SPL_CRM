import { expect, test, type Page, type Route } from '@playwright/test'

const initialEvent = {id:'11111111-1111-4111-8111-111111111111',businessUnit:'SPL',clientName:'Cliente inicial',clientPhone:null,venue:'Hacienda San José',eventDate:'2026-09-18',operationalStatus:'Confirmado',operationalNotes:null,financialNotes:null,agreedPrice:'125000.00',payrollBudget:'30000.00',extraExpenseBudget:'30000.00',version:1}

const owner={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'owner@spl.mx',displayName:'Oscar Méndez',role:'owner'}
const coordinator={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'coord@spl.mx',displayName:'Coordinación SPL',role:'coordinator'}

async function mockApi(page:Page, options:{failFirstList?:boolean;user?:typeof owner;requireLogin?:boolean;testLogin?:boolean}={}) {
  const events=[initialEvent]; let listAttempts=0
  const payments:any[]=[];const expenses:any[]=[];const payroll:any[]=[];const workers:any[]=[];const templates:any[]=[]
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
    if(/^\/api\/events\/[^/]+\/budget$/.test(url.pathname)&&method==='PATCH'){const body=request.postDataJSON();initialEvent.payrollBudget=body.payrollBudget;return route.fulfill({status:200,json:{data:initialEvent}})}
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
  await expect(page.getByText('Pagado')).toBeVisible()
})

test('updates an event payroll budget after the event was created',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Eventos'}).click();await page.getByRole('button',{name:'Modificar presupuesto'}).click();const dialog=page.getByRole('dialog',{name:'Modificar presupuesto de nómina'});await dialog.getByLabel('Presupuesto MXN').fill('45000');await dialog.getByRole('button',{name:'Guardar'}).click();await expect(page.getByText('Presupuesto $45,000.00')).toBeVisible()})




test('downloads the selected monthly Excel report',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Exportar mes'}).click();await page.getByRole('dialog',{name:'Exportar reporte mensual'}).getByLabel('Mes del reporte').fill('2026-09');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar Excel'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('SPL-reporte-2026-09.xlsx')})

test('shows reconciled finance and editable settings pages',async({page})=>{await mockApi(page);await page.goto('/');await page.getByRole('button',{name:'Finanzas'}).click();await expect(page.getByRole('heading',{name:'Finanzas'})).toBeVisible();await expect(page.getByRole('heading',{name:'Detalle por evento'})).toBeVisible();await expect(page.getByText('Cliente inicial').first()).toBeVisible();await page.screenshot({path:'../outputs/spl-finance-desktop.png',fullPage:true});await page.getByRole('button',{name:'Configuración'}).click();await expect(page.getByRole('heading',{name:'Configuración'})).toBeVisible();await expect(page.getByText('owner@spl.mx')).toBeVisible();await page.getByLabel('Unidad predeterminada').selectOption('5to Elemento');await page.getByRole('button',{name:'Guardar cambios'}).click();await expect(page.getByRole('button',{name:'Guardado'})).toBeVisible();await page.screenshot({path:'../outputs/spl-settings-desktop.png',fullPage:true})})


test('keeps finance navigation usable at iPad width',async({page})=>{await page.setViewportSize({width:820,height:1180});await mockApi(page);await page.goto('/');const sidebar=page.locator('.sidebar'),closedBox=await sidebar.boundingBox();expect(closedBox&&closedBox.x+closedBox.width<=0).toBe(true);await page.locator('.menu-button').click();await expect(sidebar).toHaveClass(/open/);await page.getByRole('button',{name:'Finanzas'}).click();await expect(page.getByRole('heading',{name:'Finanzas'})).toBeVisible();await expect.poll(async()=>{const box=await sidebar.boundingBox();return Boolean(box&&box.x+box.width<=0)}).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.screenshot({path:'../outputs/spl-finance-ipad.png',fullPage:true})})
