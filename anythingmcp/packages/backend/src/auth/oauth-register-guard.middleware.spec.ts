import { OAuthRegisterGuardMiddleware } from './oauth-register-guard.middleware';
import type { Request, Response } from 'express';

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown = undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    header(key: string, value: string) {
      headers[key] = value;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
  } as unknown as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
  return res as Response & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

function makeReq(overrides: Partial<Request>): Request {
  return {
    method: 'POST',
    headers: {},
    body: undefined,
    ...overrides,
  } as Request;
}

describe('OAuthRegisterGuardMiddleware', () => {
  const guard = new OAuthRegisterGuardMiddleware();

  it('passes through non-POST requests', () => {
    const next = jest.fn();
    const res = makeRes();
    guard.use(makeReq({ method: 'GET' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('rejects multipart/form-data with 400 invalid_client_metadata', () => {
    const next = jest.fn();
    const res = makeRes();
    guard.use(
      makeReq({
        headers: { 'content-type': 'multipart/form-data; boundary=---x' },
        body: undefined,
      }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('rejects JSON with missing redirect_uris', () => {
    const next = jest.fn();
    const res = makeRes();
    guard.use(
      makeReq({
        headers: { 'content-type': 'application/json' },
        body: { client_name: 'Claude' },
      }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('rejects JSON with empty redirect_uris', () => {
    const next = jest.fn();
    const res = makeRes();
    guard.use(
      makeReq({
        headers: { 'content-type': 'application/json' },
        body: { redirect_uris: [] },
      }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('passes valid JSON through to the controller', () => {
    const next = jest.fn();
    const res = makeRes();
    guard.use(
      makeReq({
        headers: { 'content-type': 'application/json' },
        body: { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
