export type Preferences={defaultUnit:'SPL'|'5to Elemento';reportMonth:'current'|'previous';compactMode:boolean}
export const defaultPreferences:Preferences={defaultUnit:'SPL',reportMonth:'current',compactMode:false}
export function parsePreferences(value:string|null):Preferences{if(!value)return defaultPreferences;try{const parsed=JSON.parse(value) as Record<string,unknown>;return{defaultUnit:parsed.defaultUnit==='5to Elemento'?'5to Elemento':'SPL',reportMonth:parsed.reportMonth==='previous'?'previous':'current',compactMode:parsed.compactMode===true}}catch{return defaultPreferences}}
