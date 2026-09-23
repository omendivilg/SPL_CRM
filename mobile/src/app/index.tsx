import {Redirect} from 'expo-router'
import {ActivityIndicator,View} from 'react-native'
import {useSession} from '../session'
import {colors} from '../theme'
export default function Index(){const {user,loading}=useSession();if(loading)return <View style={{flex:1,justifyContent:'center',backgroundColor:colors.background}}><ActivityIndicator color={colors.orange}/></View>;return <Redirect href={user?'/(tabs)/events':'/login'}/>}
