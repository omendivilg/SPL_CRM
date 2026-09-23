import {Pressable,Text} from 'react-native'
import {router} from 'expo-router'
import {Screen,ui} from '../../components'
import {useSession} from '../../session'
export default function Settings(){const {user,logout}=useSession();return <Screen title="Cuenta"><Text style={ui.text}>{user?.displayName}</Text><Text style={ui.label}>{user?.email}</Text><Text style={ui.label}>Rol: {user?.role}</Text><Pressable style={ui.button} onPress={async()=>{await logout();router.replace('/login')}}><Text style={ui.buttonText}>Cerrar sesión</Text></Pressable></Screen>}
