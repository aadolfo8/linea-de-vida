import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { isAllowedOrigin, loadRuntimeConfig } from './production';
export type SessionRequest = Request & { userId?: string };

export const SESSION_COOKIE = 'lv_session';
export const SESSION_MAX_AGE_MS = 30 * 86_400_000;
/** A session older than this is renewed on its next request, so active people never log out. */
const SESSION_RENEW_AFTER_MS = 86_400_000;

/** The cookie value is `<userId>.<issuedAtSeconds>`; a legacy value is the bare user id. */
export function encodeSession(userId: string, now = Date.now()) {
  return `${userId}.${Math.floor(now / 1000)}`;
}

export function decodeSession(value: unknown, now = Date.now()) {
  if (typeof value !== 'string' || !value) return null;
  const dot = value.lastIndexOf('.');
  const issued = dot > 0 ? Number(value.slice(dot + 1)) : NaN;
  // Sessions created before expiry existed have no timestamp: accept them once and stamp them.
  if (!Number.isInteger(issued)) return { userId: value, issuedAt: now, legacy: true };
  const issuedAt = issued * 1000;
  if (now - issuedAt > SESSION_MAX_AGE_MS || issuedAt > now + 60_000) return null;
  return { userId: value.slice(0, dot), issuedAt, legacy: false };
}

export function setSessionCookie(response: Response, userId: string) {
  response.cookie(SESSION_COOKIE, encodeSession(userId), {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function sessionUserId(request: Request) {
  return decodeSession(request.signedCookies?.[SESSION_COOKIE])?.userId;
}
export const CurrentUserId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<SessionRequest>().userId,
);
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionRequest>();
    const session = decodeSession(request.signedCookies?.[SESSION_COOKIE]);
    if (!session)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'A session is required.',
      });
    request.userId = session.userId;
    if (session.legacy || Date.now() - session.issuedAt > SESSION_RENEW_AFTER_MS)
      setSessionCookie(http.getResponse<Response>(), session.userId);
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.get('origin');
    if (!isAllowedOrigin(origin, loadRuntimeConfig())) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'The request origin is not allowed.',
      });
    }
    return true;
  }
}
