import { expect, test, type Page, type Route } from '@playwright/test'

const date='2026-09-30'
const userA={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'account-a@spl.test',displayName:'Cuenta A',role:'owner',unit:null}
const userB={...userA,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',userId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'account-b@spl.test',displayName:'Cuenta B'}
const eventFor=(account:'A'|'B')=>({id:account==='A'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',businessUnit:'SPL',clientName:`Cliente ${account} privado`,clientPhone:null,venue:`Lugar ${account} exclusivo`,eventDate:date,operationalStatus:'Confirmado',operationalNotes:null,financialNotes:null,agreedPrice:account==='A'?'1100.00':'2200.00',payrollBudget:'0.00',extraExpenseBudget:'0.00',version:1})

test('late loading from a signed-out owner cannot replace the next owner data',async({page},testInfo)=>{
  await page.clock.setFixedTime(new Date(`${date}T19:00:00Z`))
  let current:typeof userA|null=userA
  const heldA:Route[]=[]
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method(),account=current?.userId===userA.userId?'A':'B'
    if(path==='/api/auth/me')return route.fulfill(current?{status:200,json:{data:current}}:{status:401,json:{error:'unauthorized'}})
    if(path==='/api/auth/logout'){current=null;return route.fulfill({status:204})}
    if(path==='/api/auth/login'){current=request.postDataJSON().email===userB.email?userB:userA;return route.fulfill({status:200,json:{data:current}})}
    if(path==='/api/auth/test-login/config')return route.fulfill({status:200,json:{data:{enabled:false}}})
    if(path==='/api/events'&&method==='GET'){
      if(account==='A'){heldA.push(route);return}
      return route.fulfill({status:200,json:{data:[eventFor('B')]}})
    }
    if(path==='/api/direct-income')return route.fulfill({status:200,json:{data:[{id:`income-${account}`,name:`Utilidad ${account} privada`,businessUnit:'SPL',amount:account==='A'?'110.00':'220.00',expectedDate:date,receivedDate:date,notes:null,version:1,createdBy:current?.userId,createdAt:`${date}T19:00:00Z`}]}})
    if(path==='/api/quick-expenses')return route.fulfill({status:200,json:{data:[{id:`expense-${account}`,name:`Gasto ${account} privado`,category:'Servicios',businessUnit:'SPL',amount:account==='A'?'11.00':'22.00',expenseDate:date,notes:null,paymentMethod:'cash',createdBy:current?.userId,createdAt:`${date}T19:00:00Z`}]}})
    if(path==='/api/weekly-payroll/legacy')return route.fulfill({status:200,json:{data:{entries:[],settlements:[]}}})
    if(['/api/payroll','/api/weekly-payroll','/api/expense-settlements'].includes(path)||/^\/api\/events\/[^/]+\/(expenses|payments)$/.test(path))return route.fulfill({status:200,json:{data:[]}})
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/')
  await expect(page.locator('.user-card')).toContainText('Cuenta A')
  await expect.poll(()=>heldA.length).toBeGreaterThan(0)
  await page.locator('.user-card').click()
  await expect(page.getByRole('heading',{name:'Bienvenido'})).toBeVisible()
  await page.getByLabel('Correo electrónico').fill(userB.email)
  await page.getByLabel('Contraseña').fill('contraseña-de-prueba')
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click()
  await expect(page.locator('.user-card')).toContainText('Cuenta B')
  await expect(page.locator('.events-panel')).toContainText('Lugar B exclusivo')
  await expect(page.locator('.metric-card').filter({hasText:'Cobros registrados'})).toContainText('$220.00')
  await Promise.all(heldA.map(route=>route.fulfill({status:200,json:{data:[eventFor('A')]}})))
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.events-panel')).toContainText('Lugar B exclusivo')
  await expect(page.locator('.events-panel')).not.toContainText('Lugar A exclusivo')
  await page.getByRole('button',{name:'Finanzas',exact:true}).click()
  await expect(page.locator('.finance-income-list')).toContainText('Utilidad B privada')
  await expect(page.locator('.finance-income-list')).not.toContainText('Utilidad A privada')
  await expect(page.getByRole('region',{name:'Detalle de gastos',exact:true})).toContainText('Gasto B privado')
  await expect(page.locator('.finance-table')).toContainText('Cliente B privado')
  await expect(page.locator('.finance-table')).not.toContainText('Cliente A privado')
  await page.screenshot({path:testInfo.outputPath('owner-b-after-late-owner-a.png'),fullPage:true})
})

async function saveExpensePayroll(page:Page,concept:string,amount:string) {
  await page.getByRole('button',{name:'Nueva nómina',exact:true}).click()
  await page.getByLabel('Plantilla').selectOption('')
  await page.getByRole('button',{name:'Agregar gasto',exact:true}).click()
  await page.getByLabel('Concepto del gasto 1').fill(concept)
  await page.getByLabel('Importe del gasto 1').fill(amount)
  const response=page.waitForResponse(value=>value.url().includes('/api/weekly-payroll/')&&value.request().method()==='PUT')
  await page.getByRole('button',{name:'Guardar nómina',exact:true}).click()
  const saved=(await (await response).json()).data
  await expect(page.getByRole('heading',{name:'Nóminas',exact:true})).toBeVisible()
  return saved
}

test('the newest refresh wins when two payroll changes finish loading out of order',async({page},testInfo)=>{
  await page.clock.setFixedTime(new Date(`${date}T19:00:00Z`))
  const login=await page.request.post('/api/auth/test-login')
  expect(login.ok()).toBe(true)
  const created=await page.request.post('/api/events',{data:{businessUnit:'SPL',clientName:'Cliente de actualizaciones',venue:`Carga inicial ${crypto.randomUUID().slice(0,8)}`,eventDate:date,agreedPrice:'100.00'}})
  expect(created.ok()).toBe(true)
  const event=(await created.json()).data,batches:any[]=[],held:Route[]=[]
  let phase:'initial'|'older'|'newest'='initial'
  await page.route('**/api/events',async route=>{
    if(route.request().method()!=='GET')return route.continue()
    if(phase==='older'){held.push(route);return}
    return route.fulfill({status:200,json:{data:[{...event,venue:phase==='newest'?'Actualización más reciente':event.venue}]}})
  })
  try {
    await page.goto('/')
    await expect(page.locator('.events-panel')).toContainText(event.venue)
    await page.getByRole('button',{name:'Nómina',exact:true}).click()
    phase='older'
    batches.push(await saveExpensePayroll(page,'Primer cambio controlado','85.31'))
    await expect.poll(()=>held.length).toBeGreaterThan(0)
    phase='newest'
    batches.push(await saveExpensePayroll(page,'Segundo cambio controlado','86.31'))
    await page.getByRole('button',{name:'Panel general'}).click()
    await expect(page.locator('.events-panel')).toContainText('Actualización más reciente')
    await Promise.all(held.map(route=>route.fulfill({status:200,json:{data:[{...event,venue:'Actualización anterior atrasada'}]}})))
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.events-panel')).toContainText('Actualización más reciente')
    await expect(page.locator('.events-panel')).not.toContainText('Actualización anterior atrasada')
    await page.getByRole('button',{name:'Eventos',exact:true}).click()
    await expect(page.locator('.event-table-row')).toContainText('Actualización más reciente')
    await page.screenshot({path:testInfo.outputPath('newest-refresh-kept.png'),fullPage:true})
  } finally {
    for(const batch of batches)await page.request.delete(`/api/weekly-payroll/${batch.id}`,{data:{version:batch.version,idempotencyKey:crypto.randomUUID(),confirmPaid:false}})
    await page.request.delete(`/api/events/${event.id}`,{data:{version:event.version}})
  }
})
