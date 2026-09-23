import 'dotenv/config'
import {readFile,readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {Pool} from 'pg'

const databaseUrl=process.env.DATABASE_URL
if(!databaseUrl)throw new Error('DATABASE_URL is required')
const pool=new Pool({connectionString:databaseUrl,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined,max:1})
try{
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const directory=resolve(process.cwd(),'server/db/migrations')
  for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
    const exists=await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])
    if(exists.rowCount)continue
    const client=await pool.connect()
    try{await client.query('BEGIN');await client.query(await readFile(resolve(directory,name),'utf8'));await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);await client.query('COMMIT');console.log(`Applied ${name}`)}
    catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
}finally{await pool.end()}
