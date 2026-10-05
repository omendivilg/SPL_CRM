import type {PropsWithChildren,ReactNode} from 'react'
import {useState} from 'react'
import {ActivityIndicator,Image,Pressable,ScrollView,StyleSheet,Text,TextInput,View,type TextInputProps} from 'react-native'
import {SafeAreaView} from 'react-native-safe-area-context'
import {colors} from './theme'
import {useSession,type BusinessScope} from './session'
const scopes:BusinessScope[]=['SPL','5to Elemento','Todos']
export function Screen({title,action,children,loading=false}:{title:string;action?:ReactNode;loading?:boolean}&PropsWithChildren){
  const {user,businessScope,setBusinessScope}=useSession()
  const [choosing,setChoosing]=useState(false)
  return <SafeAreaView style={styles.safe} edges={['top','left','right']}>
    <View style={styles.head}>
      <View style={styles.brand}>
        <Image source={businessScope==='5to Elemento'?require('../assets/quinto-elemento-logo.png'):require('../assets/spl-logo.png')} style={styles.logo} resizeMode="contain"/>
        <Pressable accessibilityRole="button" accessibilityLabel={`Vista de negocio: ${businessScope}`} accessibilityState={{expanded:choosing}} disabled={!user||user.role==='coordinator'} onPress={()=>setChoosing(value=>!value)} style={styles.businessSelector}>
          <View style={{flex:1,gap:2}}><Text style={styles.scopeLabel}>Vista de negocio</Text><Text style={styles.brandTitle}>{businessScope}</Text></View>
          {user?.role!=='coordinator'&&<Text style={styles.chevron}>{choosing?'⌃':'⌄'}</Text>}
        </Pressable>
      </View>
      {choosing&&user?.role!=='coordinator'&&<View style={styles.scopeChoices}>{scopes.map(scope=><Pressable key={scope} accessibilityRole="radio" accessibilityState={{selected:businessScope===scope}} onPress={()=>{setBusinessScope(scope);setChoosing(false)}} style={[styles.scopeChoice,businessScope===scope&&styles.scopeSelected]}><Text style={ui.text}>{scope}</Text></Pressable>)}</View>}
      <View style={styles.titleRow}><Text style={styles.title}>{title}</Text>{action&&<View style={styles.action}>{action}</View>}</View>
    </View>
    {loading?<ActivityIndicator color={colors.orange} size="large"/>:<ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>}
  </SafeAreaView>
}
export function Card({children,onPress}:{children:ReactNode;onPress?:()=>void}){return <Pressable disabled={!onPress} onPress={onPress} style={styles.card}>{children}</Pressable>}
export function Money({value,color=colors.text}:{value:string|number;color?:string}){return <Text style={[styles.money,{color}]}>{new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(value))}</Text>}
export function Field({label,...props}:TextInputProps&{label:string}){return <View style={{gap:6}}><Text style={ui.label}>{label}</Text><TextInput placeholderTextColor="#667487" {...props} style={[ui.input,props.style]}/></View>}
export const ui=StyleSheet.create({label:{color:colors.muted,fontSize:13,lineHeight:20},text:{color:colors.text,fontSize:16,lineHeight:24},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},section:{color:colors.text,fontSize:20,fontWeight:'700',marginTop:8,marginBottom:4},empty:{color:colors.muted,fontSize:15,textAlign:'center',padding:30},button:{backgroundColor:colors.orange,borderRadius:10,paddingHorizontal:16,paddingVertical:12,alignItems:'center'},secondaryButton:{borderColor:colors.border,borderWidth:1,borderRadius:10,paddingHorizontal:16,paddingVertical:12,alignItems:'center'},buttonText:{color:'#fff',fontSize:15,fontWeight:'700'},input:{minHeight:48,color:colors.text,fontSize:16,backgroundColor:colors.panelAlt,borderWidth:1,borderColor:colors.border,borderRadius:10,paddingHorizontal:12},error:{color:'#fecaca',padding:12,backgroundColor:'#3b1717',borderRadius:10}})
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},head:{paddingHorizontal:16,paddingVertical:10,borderBottomWidth:1,borderColor:colors.border,gap:10},brand:{flexDirection:'row',alignItems:'center',gap:12,minHeight:56},logo:{width:48,height:48,borderRadius:8},businessSelector:{flex:1,minHeight:56,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:colors.panelAlt,flexDirection:'row',alignItems:'center',gap:12},scopeLabel:{color:colors.muted,fontSize:12,lineHeight:16},chevron:{color:colors.muted,fontSize:24,lineHeight:28},brandTitle:{color:colors.text,fontSize:16,lineHeight:22,fontWeight:'800'},scopeChoices:{flexDirection:'row',gap:8,flexWrap:'wrap'},scopeChoice:{minHeight:48,paddingVertical:12,paddingHorizontal:14,borderRadius:8,borderWidth:1,borderColor:colors.border,backgroundColor:colors.panel,justifyContent:'center'},scopeSelected:{borderColor:colors.orange},titleRow:{minHeight:38,flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:10},action:{flexShrink:1},title:{color:colors.text,fontSize:22,fontWeight:'800',flexShrink:1},body:{padding:16,gap:12},card:{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:16,gap:8},money:{fontSize:18,fontWeight:'800'}})
