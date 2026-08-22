# Línea de vida — especificación de producto (Fase 0)

## Decisión de producto

Línea de vida será una aplicación personal que permite recorrer fotografías seleccionadas de Google Drive por el tiempo en que fueron tomadas. El producto se basa exclusivamente en metadatos técnicos, archivos JSON de Google Takeout, estructura de carpetas y correcciones explícitas de la persona usuaria. No usa IA, ML, OCR ni reconocimiento de contenido.

La Fase 0 define y valida el diseño; no contiene código de producto, dependencias ni integraciones ejecutables.

## Problema y resultado esperado

Las bibliotecas personales de Drive suelen estar distribuidas en carpetas y contienen fechas heterogéneas. La persona necesita navegar recuerdos sin depender de que Drive haya creado o modificado un archivo en la fecha histórica correcta.

**Resultado:** una línea temporal editorial, móvil primero, que conduce de año a mes, de mes a día y de día a fotografías. Las imágenes con fecha insuficiente siguen siendo visibles en el grupo «Fecha sin concretar» y pueden corregirse manualmente.

## Alcance funcional

| Capacidades incluidas                              | Límites explícitos                                              |
| -------------------------------------------------- | --------------------------------------------------------------- |
| Inicio de sesión y vinculación consentida de Drive | No se indexa todo Drive                                         |
| Selección explícita de fuentes (carpetas)          | No IA/ML/OCR/reconocimiento de contenido                        |
| Escaneo recursivo solo dentro de cada fuente       | No inferir fecha desde `createdTime` ni `modifiedTime` de Drive |
| Resolución de fecha y precisión                    | No eliminar de inmediato un archivo ausente                     |
| Corrección manual de fecha                         | No publicar, editar ni mover archivos de Drive                  |
| Navegación temporal, galería y proxy de medios     | No compartir bibliotecas entre usuarios en la primera entrega   |

## Personas y recorridos

**Persona principal:** propietario/a de una biblioteca personal en Google Drive que desea revivir fotos cronológicamente y corregir excepciones con control explícito.

1. Inicia sesión sin conceder todavía acceso a Drive.
2. Al elegir «Vincular Drive», entiende que autoriza solo lectura y selecciona una o más carpetas fuente.
3. La aplicación explora únicamente los descendientes de esas carpetas, registra el progreso y muestra incidencias recuperables.
4. Navega por años, meses, días y fotos. Puede abrir una foto y ajustar su fecha cuando la detección no sea fiable.
5. Puede desvincular Drive desde la aplicación; se revoca el acceso remoto y se invalida la conexión local.

## Principios verificables

- **Control antes que automatización:** una fuente se crea solo desde una selección explícita de carpeta; no existe una operación «escanear todo Drive».
- **Fecha honesta:** YEAR y MONTH no se convierten artificialmente al 1 de enero. La interfaz conserva su nivel de precisión.
- **Trazabilidad:** cada fecha muestra origen y confianza; el cambio manual conserva valor, precisión, motivo y momento de edición.
- **Privacidad por diseño:** las solicitudes a Drive salen del backend; el navegador no recibe tokens Google.
- **Resiliencia:** una foto sin fecha o JSON Takeout no bloquea el resto de la colección.

## Reglas de fecha

`effectiveDate` es la fecha de presentación y ordenación. Si existe una corrección manual vigente, esta gana siempre. Si no existe, usa `detectedDate` y su precisión. Si no se detecta fecha, la foto aparece en «Fecha sin concretar».

La detección automática se consulta en este orden: EXIF y `imageMediaMetadata.time` de Drive, `photoTakenTime` de Takeout y carpetas deterministas. La prioridad de `MANUAL` parece contradictoria si se la enumera junto a las fuentes de detección: se resuelve separando conceptos. `MANUAL` **no participa** en `detectedDate`; es la prioridad final de `effectiveDate`.

## Diseño de experiencia

La dirección visual es minimalismo editorial, no un dashboard. La portada prioriza el año actual disponible y una escala de tiempo clara; los contadores son auxiliares, no tarjetas de métricas. La jerarquía es año → mes → día → fotografías, con una sección separada para fechas incompletas o ausentes.

- **Móvil primero:** objetivos táctiles de al menos 44 × 44 CSS px, galería de una columna adaptable y navegación persistente hacia atrás.
- **Accesible:** HTML semántico, foco visible, contraste WCAG AA como objetivo mínimo, texto alternativo basado en nombre de archivo cuando no haya descripción, y estado/progreso anunciado con regiones vivas.
- **Medios:** el cliente consume rutas proxy propias; no expone enlaces de Drive ni credenciales.

## Primera vertical slice

La primera vertical slice debe probar el flujo completo, con una única fuente configurada:

1. Login y sesión propia.
2. Vinculación explícita de Drive con autorización `drive.readonly`.
3. Selección y registro de una carpeta fuente.
4. Escaneo recursivo limitado a **100 imágenes**.
5. Resolución por EXIF/metadatos de imagen o carpeta; **sin Takeout**.
6. Persistencia de archivos, fechas e incidencias.
7. Línea temporal de años, galería de un año y proxy de miniatura.

Quedan fuera: varias fuentes, reanudación mediante cursores, sincronización delta completa, worker BullMQ de producción, Takeout, correcciones manuales en interfaz, vista mes/día, proxy de contenido completo, HEIC transcodificado, borrado de datos, observabilidad y despliegue.

## Criterios de aceptación de Fase 0

- [x] La arquitectura separa cliente, API, base de datos y trabajo asíncrono.
- [x] La especificación prohíbe explícitamente IA/ML/OCR/reconocimiento de contenido.
- [x] Las fuentes y la identidad de foto están definidas sin escaneo global.
- [x] La prioridad y precisión de fechas no inventan días.
- [x] La vertical slice tiene límite, entradas, salidas y exclusiones comprobables.

## Referencias normativas

- Google OAuth 2.0 para aplicaciones web: <https://developers.google.com/identity/protocols/oauth2/web-server>
- Google Drive API, búsqueda de archivos: <https://developers.google.com/workspace/drive/api/guides/search-files>
