---
version: 1
slug: 'app-page-tsx'
primary_target: 'app/page.tsx'
related_targets: []
---

## Inicio — Persuade

- **Job y audiencia:** Una persona de la familia llega para recuperar recuerdos y entender cómo entrar en su archivo privado.
- **Resultado y prueba:** En segundos sabe que es una aplicación de recuerdos familiares, ve «Iniciar sesión con Google» como acción principal y entiende que después selecciona carpetas de Drive. Pruebas verdaderas: Drive es de solo lectura y solo se usan carpetas seleccionadas.
- **Dirección elegida:** Cielo nocturno (el mundo de la cronología, DESIGN.md). Fondo de cielo con el campo de estrellas compartido, marca «Línea de vida» en Bodoni Moda con trazo exterior a gran escala, una línea de propósito, el CTA «Iniciar sesión con Google» como botón claro y tres garantías en mono con marcadores de diamante. Un hilo de nodos en rombo decora el fondo; sin fotografías ni datos. Sustituye la dirección anterior de mapa/papel.
- **Alcance y límites:** Sustituir la composición de la ruta `/` sin alterar OAuth ni permisos. No mostrar fotografías privadas antes de iniciar sesión, no presentar Drive como motivo de entrada y no inventar datos/fechas familiares. Mantener modo de desarrollo solo cuando OAuth no esté configurado.
- **Estados y comportamiento:** comprobación de sesión (redirige al archivo si ya existe), llegada sin sesión, autorización disponible/no disponible, fallo de red y denegación/cancelación OAuth. El CTA inicia el endpoint Google ya existente; mensajes de error quedan visibles y asociados accesiblemente a la acción.
- **Layout e interacción:** Sin desplazamiento vertical en tamaños habituales de teléfono y escritorio; ajustar el arte al espacio restante, nunca cortar texto ni controles. Omitir animaciones imprescindibles; el botón mantiene foco visible, feedback de espera y objetivo táctil cómodo. Si el alto/zoom impide encajar el contenido, permitir scroll en vez de ocultarlo.
- **Restricciones y decisiones pendientes:** Español, React existente y tokens `sky-*` (acotados a `.sky`). Sin imagen aportada: la composición es tipográfica y vectorial, no fotografía real.
