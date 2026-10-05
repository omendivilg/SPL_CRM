import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { createWorker, listTemplates, listWorkers, savePayroll, type TeamTemplate, type Worker } from '../../api'
import { Card, Field, Money, Screen, ui } from '../../components'
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORIES } from '../../../../src/expense-categories'
import { useSession } from '../../session'
import { editableMoney, moneyCents, normalizeMoney, sumMoney } from '../../money'

type Unit = 'SPL' | '5to Elemento'
type Line = { id:string; employeeId:string; name:string; baseCost:string; additions:string; deductions:string }
type Extra = { id:string; concept:string; category:string; amount:string; notes:string }
const week = () => {
  const start = new Date()
  start.setDate(start.getDate() - (start.getDay()+5)%7)
  const end = new Date(start)
  end.setDate(end.getDate()+6)
  const local = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  return {start:local(start),end:local(end)}
}
const unitName = (unit:Unit) => unit==='SPL'?'SPL eventos propios':'5to Elemento'
const displayMoney=(value:string)=>normalizeMoney(value||'0')??value

export default function NewPayroll() {
  const {businessScope,user}=useSession()
  const dates=week()
  const [periodStart,setStart]=useState(dates.start), [periodEnd,setEnd]=useState(dates.end)
  const [name,setName]=useState(''), [unit,setUnit]=useState<Unit>(businessScope==='5to Elemento'?'5to Elemento':'SPL')
  const [workers,setWorkers]=useState<Worker[]>([]), [templates,setTemplates]=useState<TeamTemplate[]>([])
  const [lines,setLines]=useState<Line[]>([]), [expenses,setExpenses]=useState<Extra[]>([])
  const [newName,setNewName]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const apply=(template:TeamTemplate,directory:Worker[])=>{
    setUnit(template.businessUnit)
    setLines(template.lines.map(line=>({id:Crypto.randomUUID(),...line,name:directory.find(worker=>worker.id===line.employeeId)?.name??'Trabajador'})))
    setExpenses(template.expenses.map(expense=>({id:Crypto.randomUUID(),...expense})))
  }
  useEffect(()=>{
    Promise.all([listWorkers(),listTemplates()]).then(([directory,teams])=>{
      const visible=teams.filter(team=>businessScope==='Todos'||team.businessUnit===businessScope)
      setWorkers(directory);setTemplates(visible)
      const preset=visible.find(team=>team.isDefault&&team.businessUnit===(businessScope==='5to Elemento'?'5to Elemento':'SPL'))
      if(preset)apply(preset,directory)
    }).catch(reason=>setError(reason instanceof Error?reason.message:'No se pudo cargar.'))
  },[businessScope])
  const add=(worker:Worker)=>{
    if(!lines.some(line=>line.employeeId===worker.id))setLines(current=>[...current,{id:Crypto.randomUUID(),employeeId:worker.id,name:worker.name,baseCost:'0.00',additions:'0.00',deductions:'0.00'}])
  }
  const update=(id:string,key:'baseCost'|'additions'|'deductions',value:string)=>setLines(current=>current.map(line=>line.id===id?{...line,[key]:value}:line))
  const updateExpense=(id:string,key:'concept'|'category'|'amount'|'notes',value:string)=>setExpenses(current=>current.map(expense=>expense.id===id?{...expense,[key]:value}:expense))
  const total=lines.reduce((sum,line)=>sum+Number(line.baseCost||0)+Number(line.additions||0)-Number(line.deductions||0),0)+expenses.reduce((sum,expense)=>sum+Number(expense.amount||0),0)
  const save=async()=>{
    setBusy(true);setError('')
    try{
      if(!lines.length&&!expenses.length)throw new Error('Agrega un trabajador o un gasto.')
      if(!periodStart||!periodEnd||periodStart>periodEnd)throw new Error('Revisa las fechas de la nómina.')
      const normalizedExpenses=expenses.map(expense=>{
        const amount=normalizeMoney(expense.amount)
        if(!expense.concept.trim()||!expense.category||!amount||amount==='0.00')throw new Error('Cada gasto necesita nombre, categoría e importe mayor que cero.')
        return {id:expense.id,concept:expense.concept.trim(),category:expense.category,amount,notes:expense.notes,scope:'warehouse',eventId:null}
      })
      const normalizedLines=lines.map(line=>{
        const baseCost=normalizeMoney(line.baseCost||'0'),additions=normalizeMoney(line.additions||'0'),deductions=normalizeMoney(line.deductions||'0')
        if(!baseCost||!additions||!deductions)throw new Error(`Revisa los importes de ${line.name}.`)
        const gross=sumMoney(baseCost,additions)
        if(moneyCents(deductions)>moneyCents(gross))throw new Error(`Las deducciones de ${line.name} son demasiado altas.`)
        return {id:line.id,employeeId:line.employeeId,baseCost,additions,deductions,allocations:[{scope:'warehouse',eventId:null,amount:gross}]}
      })
      const id=Crypto.randomUUID()
      await savePayroll(id,{version:0,idempotencyKey:Crypto.randomUUID(),name:name.trim()||undefined,businessUnit:unit,periodStart,periodEnd,
        lines:normalizedLines,expenses:normalizedExpenses})
      router.replace('/(tabs)/payroll')
    }catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.')}finally{setBusy(false)}
  }
  if(user?.role==='coordinator')return <Screen title="Nueva nómina"><Text style={ui.error}>No tienes acceso a Nómina.</Text></Screen>
  return <Screen title="Nueva nómina">
    <Text style={ui.section}>Semana y plantilla</Text>
    <Field label="Nombre de la nómina (opcional)" maxLength={120} value={name} onChangeText={setName}/>
    <Text style={ui.label}>Unidad de negocio</Text>
    <View style={ui.row}>{(['SPL','5to Elemento'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio" accessibilityState={{selected:unit===choice}} style={[ui.secondaryButton,{flex:1,borderColor:unit===choice?'#f97316':'#394555'}]} onPress={()=>setUnit(choice)}><Text style={ui.buttonText}>{unitName(choice)}</Text></Pressable>)}</View>
    <Field label="Inicio (AAAA-MM-DD)" value={periodStart} onChangeText={setStart}/>
    <Field label="Fin (AAAA-MM-DD)" value={periodEnd} onChangeText={setEnd}/>
    {templates.length>0&&<><Text style={ui.section}>Plantillas</Text>{templates.map(template=><Pressable key={template.id} style={ui.secondaryButton} onPress={()=>apply(template,workers)}><Text style={ui.buttonText}>{template.name} · {unitName(template.businessUnit)}{template.isDefault?' · Predeterminada':''}</Text></Pressable>)}</>}
    <Text style={ui.section}>Agregar trabajador</Text>
    {workers.filter(worker=>!lines.some(line=>line.employeeId===worker.id)).map(worker=><Pressable key={worker.id} style={ui.secondaryButton} onPress={()=>add(worker)}><Text style={ui.buttonText}>+ {worker.name}</Text></Pressable>)}
    <Field label="Crear trabajador" value={newName} onChangeText={setNewName}/>
    <Pressable style={ui.secondaryButton} onPress={async()=>{try{const worker=await createWorker(newName.trim());setWorkers(current=>[...current,worker]);add(worker);setNewName('')}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo crear.')}}}><Text style={ui.buttonText}>Crear y agregar</Text></Pressable>
    <Text style={ui.section}>Equipo</Text>
    {lines.map(line=><Card key={line.id}><View style={ui.row}><Text style={ui.text}>{line.name}</Text><Pressable onPress={()=>setLines(current=>current.filter(item=>item.id!==line.id))}><Text style={ui.label}>Quitar</Text></Pressable></View><Field label="Sueldo base" value={line.baseCost} onFocus={()=>update(line.id,'baseCost',editableMoney(line.baseCost))} onBlur={()=>update(line.id,'baseCost',displayMoney(line.baseCost))} onChangeText={value=>update(line.id,'baseCost',value)} keyboardType="decimal-pad"/><Field label="Adiciones" value={line.additions} onFocus={()=>update(line.id,'additions',editableMoney(line.additions))} onBlur={()=>update(line.id,'additions',displayMoney(line.additions))} onChangeText={value=>update(line.id,'additions',value)} keyboardType="decimal-pad"/><Field label="Deducciones" value={line.deductions} onFocus={()=>update(line.id,'deductions',editableMoney(line.deductions))} onBlur={()=>update(line.id,'deductions',displayMoney(line.deductions))} onChangeText={value=>update(line.id,'deductions',value)} keyboardType="decimal-pad"/></Card>)}
    <View style={ui.row}><Text style={ui.section}>Otros gastos</Text><Pressable onPress={()=>setExpenses(current=>[...current,{id:Crypto.randomUUID(),concept:'',category:DEFAULT_EXPENSE_CATEGORY,amount:'',notes:''}])}><Text style={ui.label}>+ Agregar</Text></Pressable></View>
    {expenses.map(expense=><Card key={expense.id}><View style={ui.row}><Text style={ui.text}>Gasto</Text><Pressable onPress={()=>setExpenses(current=>current.filter(item=>item.id!==expense.id))}><Text style={ui.label}>Quitar</Text></Pressable></View><Field label="Nombre del gasto" value={expense.concept} onChangeText={value=>updateExpense(expense.id,'concept',value)}/><Text style={ui.label}>Categoría de gasto</Text>{EXPENSE_CATEGORIES.map(category=><Pressable key={category} accessibilityRole="radio" accessibilityState={{selected:expense.category===category}} onPress={()=>updateExpense(expense.id,'category',category)}><Text style={[ui.label,expense.category===category&&{color:'#f97316'}]}>{expense.category===category?'●':'○'} {category}</Text></Pressable>)}<Field label="Importe" value={expense.amount} onChangeText={value=>updateExpense(expense.id,'amount',value)} keyboardType="decimal-pad"/><Field label="Notas opcionales" value={expense.notes} onChangeText={value=>updateExpense(expense.id,'notes',value)}/></Card>)}
    <Card><Text style={ui.label}>Total de la nómina</Text><Money value={total}/></Card>
    {error&&<Text style={ui.error}>{error}</Text>}
    <Pressable disabled={busy} style={ui.button} onPress={save}><Text style={ui.buttonText}>{busy?'Guardando...':'Guardar nómina'}</Text></Pressable>
  </Screen>
}
