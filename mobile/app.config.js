module.exports=({config})=>{
  const clientId=process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID??'000000000000-local.apps.googleusercontent.com'
  const suffix='.apps.googleusercontent.com'
  if(!clientId.endsWith(suffix))throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be an iOS OAuth client ID')
  const iosUrlScheme=`com.googleusercontent.apps.${clientId.slice(0,-suffix.length)}`
  return {...config,plugins:[...(config.plugins??[]),['@react-native-google-signin/google-signin',{iosUrlScheme}]]}
}
