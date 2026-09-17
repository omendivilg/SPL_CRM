import { mkdir, readFile, rename, stat, writeFile, chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DevelopmentStore } from './dev.js'

const MAX_STORE_BYTES = 10 * 1024 * 1024

type StoredState = {
  users: DevelopmentStore['users']
  sessions: Array<[string, { userId: string; expiresAt: string; revoked: boolean }]>
  events: DevelopmentStore['events']
  expenses: Array<[string, DevelopmentStore['expenses'] extends Map<string, infer T> ? T : never]>
  payments: Array<[string, DevelopmentStore['payments'] extends Map<string, infer T> ? T : never]>
  payroll: DevelopmentStore['payroll']
  payrollSettlements: DevelopmentStore['payrollSettlements']
  workers: DevelopmentStore['workers']
  payrollTemplates: DevelopmentStore['payrollTemplates']
}

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return ['users', 'sessions', 'events', 'expenses', 'payments', 'payroll', 'payrollSettlements', 'workers', 'payrollTemplates'].every(key => Array.isArray(state[key]))
}

export class PersistentDevelopmentStore extends DevelopmentStore {
  private writeQueue = Promise.resolve()
  private constructor(private readonly filePath: string) { super() }

  static async open(filePath: string) {
    const store = new PersistentDevelopmentStore(filePath)
    await store.load()
    return store
  }

  private async load() {
    try {
      const info = await stat(this.filePath)
      if (info.size > MAX_STORE_BYTES) throw new Error('El archivo local excede el límite permitido')
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isStoredState(parsed)) throw new Error('El archivo local no tiene una estructura válida')
      this.users = parsed.users
      this.sessions = new Map(parsed.sessions.map(([key, value]) => [key, { ...value, expiresAt: new Date(value.expiresAt) }]))
      this.events = parsed.events
      this.expenses = new Map(parsed.expenses)
      this.payments = new Map(parsed.payments)
      this.payroll = parsed.payroll
      this.payrollSettlements = parsed.payrollSettlements
      this.workers = parsed.workers
      this.payrollTemplates = parsed.payrollTemplates
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private snapshot(): StoredState {
    return {
      users: this.users,
      sessions: [...this.sessions].map(([key, value]) => [key, { ...value, expiresAt: value.expiresAt.toISOString() }]),
      events: this.events,
      expenses: [...this.expenses],
      payments: [...this.payments],
      payroll: this.payroll,
      payrollSettlements: this.payrollSettlements,
      workers: this.workers,
      payrollTemplates: this.payrollTemplates,
    }
  }

  private persist() {
    const serialized = JSON.stringify(this.snapshot())
    if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) throw new Error('Los datos locales exceden el límite permitido')
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.tmp`
      await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.filePath)
      await chmod(this.filePath, 0o600).catch(() => undefined)
    })
    return this.writeQueue
  }

  override async findOrCreateGoogleUser(...args: Parameters<DevelopmentStore['findOrCreateGoogleUser']>) { const result = await super.findOrCreateGoogleUser(...args); await this.persist(); return result }
  override async createSession(...args: Parameters<DevelopmentStore['createSession']>) { await super.createSession(...args); await this.persist() }
  override async revokeSession(...args: Parameters<DevelopmentStore['revokeSession']>) { await super.revokeSession(...args); await this.persist() }
  override async create(...args: Parameters<DevelopmentStore['create']>) { const result = await super.create(...args); await this.persist(); return result }
  override async updatePayrollBudget(...args: Parameters<DevelopmentStore['updatePayrollBudget']>) { const result = await super.updatePayrollBudget(...args); await this.persist(); return result }
  override async addExpense(...args: Parameters<DevelopmentStore['addExpense']>) { const result = await super.addExpense(...args); await this.persist(); return result }
  override async addPayment(...args: Parameters<DevelopmentStore['addPayment']>) { const result = await super.addPayment(...args); await this.persist(); return result }
  override async addSettlement(...args: Parameters<DevelopmentStore['addSettlement']>) { const result = await super.addSettlement(...args); await this.persist(); return result }
  override async createPayroll(...args: Parameters<DevelopmentStore['createPayroll']>) { const result = await super.createPayroll(...args); await this.persist(); return result }
  override async settlePayroll(...args: Parameters<DevelopmentStore['settlePayroll']>) { const result = await super.settlePayroll(...args); await this.persist(); return result }
  override async createWorker(...args: Parameters<DevelopmentStore['createWorker']>) { const result = await super.createWorker(...args); await this.persist(); return result }
  override async createTemplate(...args: Parameters<DevelopmentStore['createTemplate']>) { const result = await super.createTemplate(...args); await this.persist(); return result }
  override async updateTemplate(...args: Parameters<DevelopmentStore['updateTemplate']>) { const result = await super.updateTemplate(...args); await this.persist(); return result }
}
