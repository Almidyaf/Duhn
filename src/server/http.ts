import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export function apiError(error: unknown) {
  const id = randomUUID();
  if (error instanceof AppError) return json({ code: error.code, request_id: id }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return json({ code: 'INVALID_INPUT', request_id: id }, 400);
  console.error('API operation failed', {
    request_id: id,
    error_type: error instanceof Error ? error.name : 'unknown',
  });
  return json({ code: 'SERVICE_UNAVAILABLE', request_id: id }, 503);
}
export async function readWriteBody(request: Request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(process.env.BETTER_AUTH_URL!).origin) throw new AppError('FORBIDDEN', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError('INVALID_INPUT', 400);
  if (Number(request.headers.get('content-length')) > 16000)
    throw new AppError('INVALID_INPUT', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_INPUT', 400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 16000) {
      await reader.cancel();
      throw new AppError('INVALID_INPUT', 413);
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
