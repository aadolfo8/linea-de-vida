import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ErrorFilter } from '../src/error-filter';

const run = (error: unknown) => {
  const json = vi.fn();
  const status = vi.fn((_code: number) => ({ json }));
  const response = { headersSent: false, locals: { requestId: 'req-1' }, status };
  new ErrorFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response }) } as any);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

describe('ErrorFilter', () => {
  it('keeps the code of errors that already have one and adds the request id', () => {
    expect(
      run(new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' })),
    ).toEqual({
      status: 404,
      body: { code: 'PHOTO_NOT_FOUND', message: 'Photo not found.', requestId: 'req-1' },
    });
  });

  it('gives framework errors a generic code and flattens validation messages', () => {
    expect(run(new NotFoundException()).body.code).toBe('NOT_FOUND');
    const validation = run(
      new BadRequestException({ message: ['a must be a string', 'b is required'] }),
    );
    expect(validation.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'a must be a string; b is required',
    });
  });

  it('hides unexpected failures behind a 500', () => {
    const result = run(new Error('secret connection string'));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
      requestId: 'req-1',
    });
  });
});
