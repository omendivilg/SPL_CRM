import {Stack} from 'expo-router'
import {StatusBar} from 'expo-status-bar'
import {SessionProvider} from '../session'
import {colors} from '../theme'
export default function Root(){return <SessionProvider><StatusBar style="light"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:colors.background}}}/></SessionProvider>}
