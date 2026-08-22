import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { isAllowedOrigin, loadRuntimeConfig } from './production';
export type SessionRequest = Request & { userId?: string };
export const CurrentUserId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<SessionRequest>().userId,
);
@Injectable()
export class SessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const userId = request.signedCookies?.lv_session;
    if (!userId)
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'A session is required.',
      });
    request.userId = userId;
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
