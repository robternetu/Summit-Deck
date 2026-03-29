import { AUTH_COOKIE_NAME, AUTH_PASSWORD, AUTH_USERNAME } from '@/lib/branding'

export const AUTH_CONFIG = {
  username: AUTH_USERNAME,
  password: AUTH_PASSWORD,
  cookieName: AUTH_COOKIE_NAME,
}

export function isAuthenticatedCookie(value: string | undefined): boolean {
  return value === '1'
}
