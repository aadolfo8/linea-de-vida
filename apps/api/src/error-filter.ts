import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA',
  429: 'RATE_LIMITED',
};

/**
 * Every error leaves the API as `{ code, message, requestId }`. Errors that already carry a `code`
 * keep it; framework errors (validation, unknown route) get a generic one; anything unexpected is
 * a 500 whose details stay in the log and never reach the client.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const requestId = response.locals?.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const record =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const message = Array.isArray(record.message)
        ? record.message.join('; ')
        : typeof record.message === 'string'
          ? record.message
          : typeof body === 'string'
            ? body
            : exception.message;
      const code =
        typeof record.code === 'string'
          ? record.code
          : status === 400 && Array.isArray(record.message)
            ? 'VALIDATION_FAILED'
            : (DEFAULT_CODES[status] ?? 'REQUEST_FAILED');
      response.status(status).json({ code, message, requestId });
      return;
    }

    this.logger.error(
      JSON.stringify({
        event: 'unhandled_error',
        requestId,
        name: exception instanceof Error ? exception.name : typeof exception,
      }),
    );
    response
      .status(500)
      .json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId });
  }
}
