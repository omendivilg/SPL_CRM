import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import type { Principal, Role, BusinessUnit } from './domain.js'

export type LoginUser={id:string;email:string;displayName:string;role:Role;businessUnit:BusinessUnit|null;passwordHash:string|null;active:boolean}
export interface SessionStore {
  findUserByEmail(email:string):Promise<LoginUser|null>
  createSession(userId:string,tokenHash:string,expiresAt:Date):Promise<void>
  findPrincipal(tokenHash:string,now:Date):Promise<(Principal&{email:string;displayName:string})|null>
  revokeSession(tokenHash:string):Promise<void>
  findOrCreateGoogleUser(email:string,displayName:string,role:Role,businessUnit:BusinessUnit|null):Promise<LoginUser>
}
export const hashSessionToken=(token:string)=>createHash('sha256').update(token).digest('hex')
export const newSessionToken=()=>randomBytes(32).toString('base64url')

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool:Pool){}
  async findUserByEmail(email:string){const result=await this.pool.query<LoginUser>('SELECT id, email, display_name AS "displayName", role, business_unit AS "businessUnit", password_hash AS "passwordHash", active FROM users WHERE email = $1',[email]);return result.rows[0]??null}
  async createSession(userId:string,tokenHash:string,expiresAt:Date){await this.pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',[userId,tokenHash,expiresAt])}
  async findPrincipal(tokenHash:string,now:Date){const result=await this.pool.query<Principal&{email:string;displayName:string}>('SELECT u.id AS "userId", u.role, u.business_unit AS unit, u.email, u.display_name AS "displayName" FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.active = true',[tokenHash,now]);return result.rows[0]??null}
  async revokeSession(tokenHash:string){await this.pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',[tokenHash])}
  async findOrCreateGoogleUser(email:string,displayName:string,role:Role,businessUnit:BusinessUnit|null){const result=await this.pool.query<LoginUser>('INSERT INTO users (email, display_name, password_hash, role, business_unit) VALUES ($1,$2,NULL,$3,$4) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id, email, display_name AS "displayName", role, business_unit AS "businessUnit", password_hash AS "passwordHash", active',[email,displayName,role,businessUnit]);return result.rows[0]}
}
