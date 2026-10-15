---
version: 1
slug: 'app-page-tsx'
primary_target: 'app/page.tsx'
related_targets: []
---

## Inicio — Persuade

- **Job y audiencia:** Una persona de la familia llega para recuperar recuerdos y entender cómo entrar en su archivo privado.
- **Resultado y prueba:** En segundos sabe que es una aplicación de recuerdos familiares, ve «Iniciar sesión con Google» como acción principal y entiende que después selecciona carpetas de Drive. Pruebas verdaderas: Drive es de solo lectura y solo se usan carpetas seleccionadas.
- **Dirección elegida:** Mapa familiar desplegado, aprobada por el usuario. Reutiliza el mundo cartográfico ya implementado (papel, tinta azul verdosa, rutas menta y señal coral); composición en dos columnas en escritorio, y arte de mapa/fotografía ilustrada arriba con acceso en primer plano en móvil. La ilustración SVG actual es temporal hasta que el usuario aporte su imagen. Tres garantías discretas anclan privacidad, selección explícita y solo lectura.
- **Alcance y límites:** Sustituir la composición de la ruta `/` sin alterar OAuth ni permisos. No mostrar fotografías privadas antes de iniciar sesión, no presentar Drive como motivo de entrada y no inventar datos/fechas familiares. Mantener modo de desarrollo solo cuando OAuth no esté configurado.
- **Estados y comportamiento:** comprobación de sesión (redirige al archivo si ya existe), llegada sin sesión, autorización disponible/no disponible, fallo de red y denegación/cancelación OAuth. El CTA inicia el endpoint Google ya existente; mensajes de error quedan visibles y asociados accesiblemente a la acción.
- **Layout e interacción:** Sin desplazamiento vertical en tamaños habituales de teléfono y escritorio; ajustar el arte al espacio restante, nunca cortar texto ni controles. Omitir animaciones imprescindibles; el botón mantiene foco visible, feedback de espera y objetivo táctil cómodo. Si el alto/zoom impide encajar el contenido, permitir scroll en vez de ocultarlo.
- **Restricciones y decisiones pendientes:** Español, Next.js/Tailwind existentes y tokens `map-*`. Falta la imagen que el usuario se comprometió a aportar; hasta entonces se usa una ilustración vectorial propia, no fotografía real.
