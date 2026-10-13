import {useCallback,useRef,useState} from 'react'
import {useFocusEffect} from 'expo-router'
import {Pressable,ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native'
import {type WeeklyPoint} from '../../src/dashboard/weekly'
import {Card,Money,ui} from './components'
import {useFinancialPeriod} from './financial-period'
import {colors} from './theme'

export const formatMoney=(value:number)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(value)
const chartColors=['#F97316','#FB923C','#EA580C','#EF4444','#FCA569','#DC2626','#FDBA74']
export function FinancialPeriodControl(){
  const {selectedPeriod,period,setSelectedPeriod,shift,error}=useFinancialPeriod()
  return <View style={styles.period}>
    <View style={ui.row}>{(['week','month'] as const).map(mode=><Pressable key={mode} accessibilityRole="radio" accessibilityState={{selected:selectedPeriod.mode===mode}} onPress={()=>setSelectedPeriod({...selectedPeriod,mode})} style={[ui.secondaryButton,styles.mode,selectedPeriod.mode===mode&&styles.selected]}><Text style={ui.buttonText}>{mode==='week'?'Semana':'Mes'}</Text></Pressable>)}</View>
    <View style={ui.row}><Pressable accessibilityRole="button" accessibilityLabel={selectedPeriod.mode==='week'?'Semana anterior':'Mes anterior'} onPress={()=>shift(-1)} style={styles.arrow}><Text style={styles.arrowText}>{'<'}</Text></Pressable><Text accessibilityRole="header" style={styles.periodLabel}>{period.label}</Text><Pressable accessibilityRole="button" accessibilityLabel={selectedPeriod.mode==='week'?'Semana siguiente':'Mes siguiente'} onPress={()=>shift(1)} style={styles.arrow}><Text style={styles.arrowText}>{'>'}</Text></Pressable></View>
    {error?<Text style={ui.error}>{error}</Text>:null}
  </View>
}

export function CategoryBars({items}:{items:{name:string;amount:number}[]}){
  const maximum=Math.max(1,...items.map(item=>item.amount))
  return <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{paddingTop:12,paddingBottom:8}} accessibilityLabel="Gráfica de gastos por categoría">
    <View style={styles.categoryPlot}>{items.map((item,index)=><View key={item.name} accessible accessibilityLabel={`${item.name}: ${formatMoney(item.amount)}`} style={styles.categoryColumn}>
      <Text style={styles.barValue}>{new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',notation:'compact',maximumFractionDigits:1}).format(item.amount)}</Text>
      <View style={styles.barTrack}><View style={[styles.bar,{height:Math.max(item.amount?4:2,168*item.amount/maximum),backgroundColor:chartColors[index%chartColors.length],opacity:item.amount?1:0.3}]}/></View>
      <Text numberOfLines={2} style={styles.categoryLabel}>{item.name}</Text>
    </View>)}</View>
  </ScrollView>
}

type ChartPoint=WeeklyPoint&{incoming:number}
export function WeeklyCashChart({points}:{points:ChartPoint[]}){
  const [focused,setFocused]=useState(points.length-1)
  const scroll=useRef<ScrollView>(null),viewport=useRef(0),contentWidth=useRef(0),pending=useRef(true)
  const showLatest=useCallback(()=>{
    if(pending.current&&viewport.current>0&&contentWidth.current>0&&scroll.current){
      scroll.current.scrollToEnd({animated:false})
      pending.current=false
    }
  },[])
  useFocusEffect(useCallback(()=>{
    pending.current=true
    setFocused(points.length-1)
    showLatest()
  },[points.length,showLatest]))
  const columns=points.length,step=76,padding=24,height=190,width=Math.max(0,columns-1)*step+padding*2
  const minimum=Math.min(0,...points.map(point=>point.profit)),maximum=Math.max(1,...points.flatMap(point=>[point.incoming,point.expenses,point.profit]))
  const range=maximum-minimum, y=(value:number)=>height-(value-minimum)/range*height
  const series=[{key:'expenses' as const,name:'Gastos',color:colors.orange},{key:'incoming' as const,name:'Entradas',color:colors.green},{key:'profit' as const,name:'Ganancias',color:colors.text}]
  const selected=points[Math.min(focused,points.length-1)]
  return <Card>
    <Text style={ui.section}>Gastos y ganancias por semana</Text>
    <View style={styles.legend}>{series.map(item=><View key={item.key} style={styles.legendItem}><View style={[styles.dot,{backgroundColor:item.color}]}/><Text style={ui.label}>{item.name}</Text></View>)}</View>
    <Text style={ui.label}>Entradas antes de devoluciones. Ganancias después de devoluciones y pagos.</Text>
    <Text style={ui.label}>Desliza la gráfica para ver las semanas anteriores.</Text>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator onLayout={event=>{viewport.current=event.nativeEvent.layout.width;showLatest()}} onContentSizeChange={width=>{contentWidth.current=width;showLatest()}}>
      <View style={{width:width+58,paddingLeft:58,paddingTop:14,paddingBottom:6}}>
        <View style={{width,height:height+32}}>
          {[0,0.5,1].map(position=>{const value=minimum+range*position;return <View key={position} style={[styles.gridLine,{top:y(value),width}]}><Text style={styles.axisLabel}>{new Intl.NumberFormat('es-MX',{notation:'compact',maximumFractionDigits:1}).format(value)}</Text></View>})}
          {minimum<0&&<View style={[styles.zeroLine,{top:y(0),width}]}/>}
          {series.map(item=><View key={item.key} pointerEvents="none">{points.map((point,index)=>{
            const x=padding+index*step,pointY=y(point[item.key]),next=points[index+1]
            const length=next?Math.hypot(step,y(next[item.key])-pointY):0,angle=next?Math.atan2(y(next[item.key])-pointY,step):0
            return <View key={point.start}>{next&&<View style={{position:'absolute',left:x+step/2-length/2,top:(pointY+y(next[item.key]))/2-1,height:2,width:length,backgroundColor:item.color,transform:[{rotate:`${angle}rad`}]}}/>}<View style={[styles.point,{left:x-4,top:pointY-4,backgroundColor:item.color}]}/></View>
          })}</View>)}
          {points.map((point,index)=><Pressable key={point.start} accessibilityRole="button" accessibilityLabel={`${point.start} al ${point.end}. Entradas ${formatMoney(point.incoming)}, gastos ${formatMoney(point.expenses)}, ganancias ${formatMoney(point.profit)}`} onPress={()=>setFocused(index)} style={{position:'absolute',left:padding+index*step-24,top:0,width:48,height:height+32,justifyContent:'flex-end'}}><Text style={[styles.weekLabel,index===focused&&{color:colors.text}]}>{point.start.slice(5).replace('-','/')}</Text></Pressable>)}
        </View>
      </View>
    </ScrollView>
    {selected&&<View style={styles.selectedWeek}><Text style={ui.label}>{selected.start} al {selected.end}</Text>{series.map(item=><View key={item.key} style={ui.row}><Text style={ui.label}>{item.name}</Text><Money value={selected[item.key]} color={item.color}/></View>)}</View>}
  </Card>
}

const weeklyMetrics=[{key:'incoming',label:'Entradas',color:colors.green},{key:'received',label:'Cobros netos',color:colors.text},{key:'payroll',label:'Nómina',color:colors.text},{key:'refunds',label:'Reembolsos',color:colors.orange},{key:'expenses',label:'Gastos',color:colors.orange},{key:'profit',label:'Ganancia',color:colors.text}] as const
const weekDate=(date:string)=>new Date(`${date}T12:00:00Z`).toLocaleDateString('es-MX',{day:'numeric',month:'short',timeZone:'UTC'})
export function WeeklySummaryCards({points}:{points:WeeklyPoint[]}){
  const {width,fontScale}=useWindowDimensions()
  const twoColumns=width>=360&&fontScale<=1.3
  return <View style={{gap:12}}>
    <Text style={ui.section}>Semanas</Text>
    {[...points].reverse().map(point=><Card key={point.start}>
      <Text accessibilityRole="header" style={[ui.text,{fontWeight:'700'}]}>{weekDate(point.start)} - {weekDate(point.end)}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',rowGap:14,columnGap:12}}>{weeklyMetrics.map(metric=><View key={metric.key} style={{width:twoColumns?'47%':'100%',minWidth:0,gap:4}}>
        <Text style={ui.label}>{metric.label}</Text>
        <Text style={{color:metric.key==='profit'&&point.profit<0?colors.danger:metric.color,fontSize:16,fontWeight:'700',flexShrink:1}}>{formatMoney(point[metric.key])}</Text>
      </View>)}</View>
    </Card>)}
  </View>
}

const styles=StyleSheet.create({period:{gap:10},mode:{flex:1,minHeight:48},selected:{borderColor:colors.orange,backgroundColor:colors.panel},arrow:{minWidth:48,minHeight:48,borderRadius:10,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,justifyContent:'center',alignItems:'center'},arrowText:{color:colors.text,fontSize:24},periodLabel:{flex:1,color:colors.text,fontSize:14,lineHeight:22,fontWeight:'600',textAlign:'center'},categoryPlot:{flexDirection:'row',borderBottomWidth:1,borderBottomColor:colors.border,gap:6},categoryColumn:{width:104,alignItems:'center',gap:10},barValue:{color:colors.text,fontSize:12,lineHeight:18,fontWeight:'600'},barTrack:{height:168,justifyContent:'flex-end',width:46},bar:{width:46,borderTopLeftRadius:9,borderTopRightRadius:9},categoryLabel:{color:colors.muted,fontSize:12,lineHeight:18,textAlign:'center',height:48,paddingHorizontal:5},legend:{flexDirection:'row',flexWrap:'wrap',gap:14},legendItem:{flexDirection:'row',alignItems:'center',gap:6},dot:{width:8,height:8,borderRadius:4},point:{position:'absolute',width:8,height:8,borderRadius:4},gridLine:{position:'absolute',height:1,backgroundColor:colors.border},zeroLine:{position:'absolute',height:1,backgroundColor:colors.muted},axisLabel:{position:'absolute',left:-54,top:-8,width:46,color:colors.muted,fontSize:11,textAlign:'right'},weekLabel:{color:colors.muted,fontSize:11,textAlign:'center',paddingVertical:6},selectedWeek:{gap:8,borderTopWidth:1,borderColor:colors.border,paddingTop:12}})
