import type { User } from '@clerk/backend'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { accounts } from './db/schema'

export type Role = 'organizer' | 'member'

export interface IActor {
  clerkUserId: string
  role: Role
}

const organizerEmail = (process.env.ORGANIZER_EMAIL ?? '').trim().toLowerCase()

// Only a verified email decides the role. Names are never trusted.
export function roleOf(user: User): Role {
  const isOrganizer =
    organizerEmail !== '' &&
    user.emailAddresses.some(
      (address) =>
        address.verification?.status === 'verified' && address.emailAddress.toLowerCase() === organizerEmail,
    )
  return isOrganizer ? 'organizer' : 'member'
}

// The club name of this user: their account's full name, or null without an account.
export async function memberName(clerkUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: accounts.name, surname: accounts.surname })
    .from(accounts)
    .where(eq(accounts.clerkUserId, clerkUserId))
    .limit(1)

  const name = row ? `${row.name} ${row.surname}`.replace(/\s+/g, ' ').trim() : ''
  return name || null
}
