import type { Role } from './domain.js'

const emails = (value: string | undefined) => new Set((value ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean))

export function googleAccess(email: string): { allowed: boolean; role: Role } {
  const normalized = email.trim().toLowerCase()
  const adminEmails = emails([process.env.ADMIN_EMAIL, process.env.ADMIN_EMAILS].filter(Boolean).join(','))
  return { allowed: emails(process.env.GOOGLE_ALLOWED_EMAILS).has(normalized), role: adminEmails.has(normalized) ? 'admin' : 'coordinator' }
}
