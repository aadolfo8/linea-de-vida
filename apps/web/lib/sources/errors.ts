import { ApiError } from '../api';

/** Spanish copy for what can go wrong while reading, adding or ordering photos. */
export function apiErrorCopy(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case 'FOLDER_SOURCE_OVERLAP':
      return 'Esa carpeta contiene, o está dentro de, otra que ya has añadido. Usa la que ya tienes o elige una carpeta aparte.';
    case 'FOLDER_OVERLAP_UNVERIFIED':
      return 'No pudimos comprobar si esa carpeta se solapa con las que ya tienes. Revisa que Drive siga conectado e inténtalo de nuevo.';
    case 'FOLDER_NOT_FOUND':
      return 'No encontramos esa carpeta en tu Drive. Comprueba el enlace y que tu cuenta tenga acceso.';
    case 'INVALID_FOLDER':
      return 'Indica una carpeta concreta de Drive. Nunca recorremos todo tu Drive.';
    case 'INVALID_SOURCE_TYPE':
      return 'No reconocemos ese tipo de origen. Vuelve a elegirlo.';
    case 'CONNECTION_NOT_FOUND':
      return 'Drive no está conectado. Conéctalo de nuevo para seguir.';
    case 'SOURCE_SYNC_ACTIVE':
      return 'Estamos leyendo esa carpeta ahora mismo. Espera a que termine para quitarla.';
    case 'SYNC_ENQUEUE_FAILED':
      return 'No pudimos empezar a buscar fotos nuevas. Inténtalo de nuevo en un momento.';
    case 'SOURCE_NOT_FOUND':
      return 'Ese origen de fotos ya no existe. Recarga la página.';
    default:
  }
  if (error.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  if (error.status === 403)
    return 'Google no nos deja leer esa carpeta. Comprueba que tu cuenta tenga acceso o vuelve a conectar Drive.';
  if (error.status === 429)
    return 'Hay demasiadas peticiones seguidas. Espera unos segundos e inténtalo de nuevo.';
  if (error.status >= 500)
    return 'Algo falló por nuestra parte. Tus fotos siguen intactas; inténtalo de nuevo.';
  return fallback;
}
