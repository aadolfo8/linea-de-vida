// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const api = vi.hoisted(() => ({
  apiCall: vi.fn(),
  apiJson: vi.fn(),
  isUnauthenticated: vi.fn(),
}));

vi.mock('../lib/navigation', () => ({ useRouter: () => navigation }));
vi.mock('../lib/api', () => api);

describe('Home', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api.apiJson.mockRejectedValue(new Error('unauthenticated'));
    api.isUnauthenticated.mockReturnValue(true);
    api.apiCall.mockReset();
    navigation.replace.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('presents a family-memory welcome and explicit Google sign-in without Drive as the entry action', async () => {
    await act(async () => root.render(<Home />));

    expect(container.querySelector('h1')?.textContent).toBe('Línea de vida');
    expect(container.querySelector<HTMLButtonElement>('button')?.textContent).toContain(
      'Iniciar sesión con Google',
    );
    expect(container.querySelector('button')?.textContent).not.toContain('Google Drive');
    expect(container.querySelector('img')).toBeNull();
    expect(
      [...container.querySelectorAll('.welcome-guarantees li')].map((li) => li.textContent),
    ).toEqual(['Privado por cuenta', 'Solo carpetas que eliges', 'Drive de solo lectura']);
  });

  it('reveals development sign-in only when Google authorization is unavailable', async () => {
    api.apiCall.mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, message: 'Google no está configurado.' }),
    });
    await act(async () => root.render(<Home />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(api.apiCall).toHaveBeenCalledWith('/auth/google/authorize', { method: 'POST' });
    expect(container.textContent).toContain('Entrar en modo de desarrollo');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Google no está configurado.');
    expect(container.querySelector('button')?.getAttribute('aria-describedby')).toContain(
      alert?.id,
    );
  });

  it('redirects to the Google authorization page when it is available', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '' });
    api.apiCall.mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, authorizationUrl: 'https://accounts.example/auth' }),
    });
    await act(async () => root.render(<Home />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(assign).toHaveBeenCalledWith('https://accounts.example/auth');
    vi.unstubAllGlobals();
  });

  it('shows a retryable error when the authorization request fails', async () => {
    api.apiCall.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<Home />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo iniciar sesión con Google',
    );
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });

  it('shows the OAuth cancellation notice as an alert tied to the action', async () => {
    window.history.replaceState(null, '', '/?oauth=access-denied');
    await act(async () => root.render(<Home />));
    window.history.replaceState(null, '', '/');

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Has cancelado el acceso');
    expect(container.querySelector('button')?.getAttribute('aria-describedby')).toContain(
      alert?.id,
    );
  });

  it('redirects an existing session to the timeline', async () => {
    api.apiJson.mockResolvedValue({ user: { displayName: 'Ana' } });
    await act(async () => root.render(<Home />));

    expect(navigation.replace).toHaveBeenCalledWith('/timeline');
  });

  it('keeps sign-in available and explains when the session check fails unexpectedly', async () => {
    api.apiJson.mockRejectedValue(new Error('server unavailable'));
    api.isUnauthenticated.mockReturnValue(false);
    await act(async () => root.render(<Home />));

    expect(container.querySelector('button')?.textContent).toContain('Iniciar sesión con Google');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos comprobar la sesión',
    );
  });
});
