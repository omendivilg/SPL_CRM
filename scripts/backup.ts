import 'dotenv/config'
import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto'
import {createReadStream,createWriteStream} from 'node:fs'
import {appendFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pipeline} from 'node:stream/promises'
import {Readable} from 'node:stream'
import {spawn} from 'node:child_process'
import {createGzip,createGunzip} from 'node:zlib'
import {DeleteObjectCommand,GetObjectCommand,ListObjectsV2Command,PutObjectCommand,S3Client} from '@aws-sdk/client-s3'

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value}
const databaseUrl=required('DATABASE_URL'),bucket=required('BACKUP_BUCKET'),password=required('SPL_BACKUP_KEY')
const client=new S3Client({region:process.env.AWS_REGION??'auto',endpoint:process.env.AWS_ENDPOINT_URL_S3??'https://fly.storage.tigris.dev',credentials:{accessKeyId:required('AWS_ACCESS_KEY_ID'),secretAccessKey:required('AWS_SECRET_ACCESS_KEY')}})
const prefix='postgres/'

function command(name:string,args:string[],stdout:'pipe'|'inherit'='inherit'){
  const child=spawn(name,args,{stdio:['ignore',stdout,'inherit']})
  const done=new Promise<void>((resolve,reject)=>child.once('error',reject).once('exit',code=>code===0?resolve():reject(new Error(`${name} exited with ${code}`))))
  return {child,done}
}

async function createBackup(){
  const directory=join(tmpdir(),`spl-backup-${process.pid}`);await mkdir(directory,{recursive:true})
  const timestamp=new Date().toISOString().replaceAll(':','-'),path=join(directory,`${timestamp}.dump.gz.enc`)
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(password,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv)
  await writeFile(path,Buffer.concat([Buffer.from('SPLB1'),salt,iv]))
  const dump=command('pg_dump',['--format=custom','--no-owner','--no-privileges',databaseUrl],'pipe')
  await Promise.all([pipeline(dump.child.stdout!,createGzip(),cipher,createWriteStream(path,{flags:'a'})),dump.done])
  await appendFile(path,cipher.getAuthTag())
  const keyName=`${prefix}${timestamp}.dump.gz.enc`
  await client.send(new PutObjectCommand({Bucket:bucket,Key:keyName,Body:createReadStream(path),ContentType:'application/octet-stream',Metadata:{encryption:'aes-256-gcm',format:'pg-custom-gzip'}}))
  await rm(directory,{recursive:true,force:true})
  await prune()
  console.log(`Backup uploaded: ${keyName}`)
}

async function prune(){
  const result=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix})),items=(result.Contents??[]).filter(item=>item.Key&&item.LastModified).sort((a,b)=>b.LastModified!.getTime()-a.LastModified!.getTime())
  const keep=new Set(items.slice(0,7).map(item=>item.Key!)),weekly=new Set<string>()
  for(const item of items.slice(7)){const week=`${item.LastModified!.getUTCFullYear()}-${Math.ceil((((item.LastModified!.getTime()-Date.UTC(item.LastModified!.getUTCFullYear(),0,1))/86400000)+new Date(Date.UTC(item.LastModified!.getUTCFullYear(),0,1)).getUTCDay()+1)/7)}`;if(weekly.size<4&&!weekly.has(week)){weekly.add(week);keep.add(item.Key!)}}
  await Promise.all(items.filter(item=>!keep.has(item.Key!)).map(item=>client.send(new DeleteObjectCommand({Bucket:bucket,Key:item.Key!}))))
}

async function restoreBackup(){
  const keyName=process.env.BACKUP_KEY??(await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix}))).Contents?.sort((a,b)=>(b.LastModified?.getTime()??0)-(a.LastModified?.getTime()??0))[0]?.Key
  if(!keyName)throw new Error('No backup was found')
  const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:keyName})),encrypted=Buffer.from(await response.Body!.transformToByteArray())
  if(encrypted.subarray(0,5).toString()!=='SPLB1')throw new Error('Invalid SPL backup header')
  const salt=encrypted.subarray(5,21),iv=encrypted.subarray(21,33),tag=encrypted.subarray(-16),payload=encrypted.subarray(33,-16)
  const decipher=createDecipheriv('aes-256-gcm',scryptSync(password,salt,32),iv);decipher.setAuthTag(tag)
  const restore=spawn('pg_restore',['--clean','--if-exists','--no-owner','--no-privileges','--dbname',databaseUrl],{stdio:['pipe','inherit','inherit']})
  await Promise.all([pipeline(Readable.from(payload),decipher,createGunzip(),restore.stdin),new Promise<void>((resolve,reject)=>restore.once('error',reject).once('exit',code=>code===0?resolve():reject(new Error(`pg_restore exited with ${code}`))))])
  console.log(`Backup restored: ${keyName}`)
}

const action=process.argv[2]
if(action==='create')await createBackup()
else if(action==='restore')await restoreBackup()
else throw new Error('Use create or restore')
