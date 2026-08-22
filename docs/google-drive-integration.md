# Línea de vida — integración con Google Drive (Fase 0)

## Contrato de acceso

El onboarding solicita identidad y Drive en una sola autorización: `openid email profile` y exactamente `https://www.googleapis.com/auth/drive.readonly`. Usa PKCE, `state` de un solo uso, `access_type=offline`, `include_granted_scopes=true` y `prompt=consent select_account`, para que el usuario elija una cuenta y conceda ambos permisos una sola vez. La separación se conserva internamente: `User` identifica a la persona y `OAuthConnection` registra el permiso Drive. [OAuth 2.0 para web](https://developers.google.com/identity/protocols/oauth2/web-server)

| Etapa                  | Acción backend                                                                         | Garantía                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Autorización combinada | Redirige con identidad, `drive.readonly`, offline, PKCE y selección de cuenta          | Una sola acción y una sola cuenta para login y Drive.                                        |
| Callback               | Verifica `state`, intercambia `code`, comprueba identidad/scopes y cifra refresh token | Crea/actualiza `User` y `OAuthConnection` en una transacción; el navegador no recibe tokens. |
| Selección              | Registra carpeta por su `driveFolderId`                                                | Solo es raíz de fuente si el usuario la eligió.                                              |
| Revocación             | Llama al endpoint de revocación de Google y marca la conexión local                    | Se corta el uso futuro incluso si hay reintento remoto pendiente.                            |

Mientras OAuth esté en **Testing**, hay que añadir la cuenta real del usuario en **Google Auth platform → Audience → Test users**. Ser usuario de prueba permite usar la aplicación privada durante Testing; no es la verificación pública de Google. La aplicación deberá completar la verificación pública antes de producción cuando la audiencia, configuración o scopes aplicables lo requieran.

## Restricción de alcance

No se usa una consulta que enumere la unidad completa. Para cada `PhotoSource`, el adaptador comienza con `driveFolderId` y lista hijos mediante una condición equivalente a «el folder es padre», continuando de manera recursiva solo desde carpetas descendientes. Se persiste la relación de fuente del resultado para impedir que una foto aparezca por una raíz no autorizada.

La creación de fuente exige seleccionar/confirmar una carpeta; la API rechaza `root`, IDs vacíos y fuentes de otra conexión/usuario. El producto puede añadir Drive Picker en la implementación, pero este documento no presupone un SDK de interfaz.

## Drive Adapter

El dominio depende de una interfaz propia, no de clases del SDK de Google:

| Operación            | Entrada                            | Salida normalizada                                                           |
| -------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `listChildren`       | conexión, `folderId`, `pageCursor` | archivos, `nextCursor`                                                       |
| `getFileMetadata`    | conexión, `driveFileId`            | MIME, nombre, padres, metadatos de imagen y vínculos de thumbnail si existen |
| `getThumbnailStream` | conexión, archivo, tamaño          | stream y content type                                                        |
| `getContentStream`   | conexión, archivo                  | stream y content type                                                        |

La API de Drive usa `files.list`, permite limitar campos y devuelve `nextPageToken` para continuar la paginación; se solicitarán solo los campos necesarios. [Búsqueda de archivos](https://developers.google.com/workspace/drive/api/guides/search-files) y [metadatos de archivo](https://developers.google.com/workspace/drive/api/guides/file-metadata). La presencia de `thumbnailLink` no se interpreta como garantía permanente: el proxy obtiene/renueva el medio como operación backend.

## Ejecución fiable

- Cursor por página: se persiste el cursor asociado a la ejecución/fuente y se reintenta desde un punto seguro.
- Concurrencia: máximo configurable entre 5 y 10 solicitudes activas por sincronización; la vertical slice inicia en 5.
- Reintento: respeta `Retry-After`; para 429 y 5xx aplica backoff exponencial con jitter y máximo de intentos. Google exige backoff exponencial ante errores de rate limit/cuota. [Límites](https://developers.google.com/workspace/drive/api/guides/limits)
- Idempotencia: el upsert se basa en `(userId, driveFileId)`. Un trabajo repetido no duplica una foto ni un override.
- Ausencias: el archivo no encontrado o no devuelto en una reconciliación queda `MISSING`; no se borra de inmediato.

## Metadatos de fecha

No se utilizan `createdTime` ni `modifiedTime` de Drive como fecha histórica: describen eventos del archivo en Drive, no necesariamente cuándo se tomó la fotografía. Solo se consideran EXIF extraído del binario cuando corresponda y `imageMediaMetadata.time` cuando Drive lo proporciona. La normalización registra la fuente exacta y precisión.

## Takeout defensivo

Takeout se introducirá después de la vertical slice. Su JSON es auxiliar y no fiable: puede faltar, ser inválido, no corresponder a una foto o tener un nombre alterado. El matcher intenta, en orden, adyacencia de archivo, nombre exacto, nombre sin extensión y título declarado; registra ambigüedades y no asigna ante más de un candidato. Una foto sin JSON **nunca** se descarta. `photoTakenTime` solo se acepta si su formato es válido y proporciona una fecha.

## Proxies de media

`GET /v1/photos/{photoId}/thumbnail` y `GET /v1/photos/{photoId}/content` verifican que `photo.userId` pertenece a la sesión antes de usar `driveFileId`. Devuelven stream con allowlist de tipos y cabeceras de caché privadas/cortas; no redirigen al navegador a una URL Drive ni revelan tokens. Para HEIC, el proxy puede devolver el binario original como descarga/stream compatible; una representación visual o transcodificación es una decisión futura explícita.
