import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { ContextCursor } from './components/ContextCursor';

/** Every screen is its own chunk: the heavy sky engine is only downloaded where it is used. */
const screen = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

function Root() {
  return (
    <>
      <Outlet />
      <ContextCursor />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    HydrateFallback: () => null,
    children: [
      { path: '/', lazy: screen(() => import('./page')) },
      // The timeline shell reads the pathname itself and renders every depth (year, month, …).
      { path: '/timeline/*', lazy: screen(() => import('./timeline/layout')) },
      { path: '/ordenar', lazy: screen(() => import('./ordenar/page')) },
      { path: '/portadas', lazy: screen(() => import('./portadas/page')) },
      { path: '/ajustes', lazy: screen(() => import('./ajustes/page')) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
