# Auditoría del código de MAHJOY

Revisión del 1 de octubre de 2026 del servidor web, los catálogos, el carrito, el checkout en español e inglés y las rutas de Proax que reciben pagos y muestran pedidos. Se detectaron exposiciones importantes y errores funcionales; se publicaron correcciones para los hallazgos descritos abajo. Quedan pendientes de seguridad que impiden considerar cerrado todo el riesgo.

## Hallazgos corregidos

| Prioridad | Problema comprobado | Corrección |
| --- | --- | --- |
| Crítica | El servidor servía la raíz del repositorio. Antes del cambio, solicitudes HEAD a `/server.js`, `/package.json` y `/lib/paypal-sync.js` devolvían 200. El código del servidor contiene credenciales. | Lista permitida de páginas y recursos públicos, incluidos los alias de páginas sin extensión. Los archivos internos devuelven 404. La renovación de credenciales continúa pendiente. |
| Alta | Las rutas de pedidos, cambios de estado, creación de guías y herramientas de diagnóstico carecían de autorización. | Exigen una credencial del servidor en una cabecera, comparada en tiempo constante. Las solicitudes públicas a pedidos devuelven 401. La recepción de pagos PayPal sigue usando su verificación independiente. |
| Alta | La notificación entrante de CentumPay podía marcar pedidos pagados y generar envíos sin verificar la autenticidad del aviso. | El aviso solo se acepta como informativo; la confirmación depende de la consulta autenticada que ya realiza el servidor a CentumPay. No se probó una transacción real con este proveedor. |
| Alta | Proax permitía consultar pedidos usando solo el correo, o consultar un pedido por su identificador. La respuesta individual incluía dirección y enlace de guía. | Ambas rutas requieren identificador y correo coincidentes, desactivan caché y omiten dirección y enlace de guía. Las páginas de consulta de ambos mercados piden los dos datos. Esto reduce la exposición; no equivale a una cuenta autenticada ni a un código de un solo uso. |
| Media | PayPal express se saltaba el formulario que pedía teléfono. El webhook podía registrar el pago antes de recibir los datos del navegador. | Teléfono obligatorio antes de abrir PayPal y antes de crear la orden. Se normaliza y guarda en el servidor con una referencia aleatoria; Proax recupera esa referencia de la orden verificada en PayPal, incluso si llega primero el webhook. No se verifica la titularidad del número por SMS. |
| Media | El evento de actualización del carrito llamaba a `updateCartTotals` fuera del alcance de esa función. Se reprodujo un ReferenceError en el navegador. | La actualización del resumen se registra dentro de su propio alcance, en ambos mercados. Prueba de regresión del evento y comprobación del carrito publicado. |
| Media | La consulta de pedidos presentaba todos los importes como MXN, incluidas ventas USD. | Proax devuelve la moneda de la venta vinculada y la web presenta ese importe en su moneda original, sin convertirlo. |
| Baja | La página inglesa de pedidos apuntaba a CSS, imagen y scripts inexistentes bajo `/en`. Varias páginas enlazaban a `shop.html`, que no existe. | Rutas de recursos corregidas. Los enlaces de tienda llevan a la sección de categorías, con un ancla existente en cada mercado. |

## Pendientes prioritarios

1. **Crítico: renovar las credenciales presentes en el código y retirarlas del repositorio.** Incluyen acceso a base de datos e integraciones de envíos, Proax y Telegram. La exposición del archivo del servidor se confirmó; no hay evidencia suficiente para afirmar si alguien utilizó esas credenciales. Deben rotarse en sus proveedores, configurarse como secretos de producción y revisarse los registros de acceso. El cierre de la descarga pública no revoca claves que ya pudieron copiarse. No se renovaron durante esta revisión.
2. **Alto: llevar la creación y captura de pagos al servidor con una cotización verificable.** El flujo habitual compara los precios actuales con Proax y rechaza productos a cero, monedas mezcladas y totales incorrectos. Sin embargo, PayPal se crea y captura desde el navegador. Esa comprobación no constituye una barrera frente a un cliente que modifica su JavaScript. La ruta heredada de CentumPay también construye importes a partir del carrito recibido. Se detectó por revisión de código; no se realizaron pagos manipulados. La verificación actual de Proax acredita el recibo real de PayPal, pero no demuestra que ese importe corresponda a una cotización autorizada del comercio.
3. **Medio: limitar solicitudes públicas y definir conservación de contactos.** Cotizaciones de envío, precios, búsqueda de pedidos y registro de teléfonos no tienen límites de tráfico específicos. El nuevo almacenamiento de contactos necesita una política de eliminación de referencias abandonadas que preserve los pagos pendientes de sincronización.
4. **Bajo: enlace Journal sin contenido.** Los pies de página de inicio apuntan a `journal.html`, que no existe. Conviene crear ese contenido o retirar el enlace. No se inventó una página editorial.

## Teléfono dentro de PayPal

El teléfono ya se exige en la web antes del pago, en carrito y checkout de ambos mercados, y queda preparado para sincronizarse con Proax. La preferencia del comercio dentro de la propia cuenta de PayPal no se modificó: el navegador solicitó inicio de sesión con una llave de seguridad física y no había una sesión utilizable.

PayPal distingue la información de contacto recogida en la tienda de la mostrada dentro de su pantalla. Su módulo de contacto documentado está disponible solo en Estados Unidos. Véase la [documentación oficial de PayPal](https://developer.paypal.com/v5/checkout/show-contact-details). No se afirma que esta corrección obligue a mostrar un campo dentro de todas las pantallas de PayPal.

## Verificación y límites

- Pruebas de la web: precios independientes MXN y USD, productos sin precio, descuentos, envíos, reintentos de sincronización, acceso a archivos, autorización y teléfono obligatorio.
- Pruebas de Proax: recibos verificados, conservación de moneda, edición de ventas, teléfono mediante webhook o navegador y consulta privada de pedidos. Comprobación TypeScript y compilación de producción satisfactorias.
- `npm audit --omit=dev` en la web: cero vulnerabilidades conocidas en las dependencias instaladas de producción. Este resultado no evalúa las reglas de negocio ni sustituye la revisión del código.
- Comprobación sintáctica de JavaScript y scripts HTML; inspección de enlaces y recursos locales.
- Comprobaciones publicadas: archivos internos 404, rutas privadas 401, consulta con un solo identificador 400, identificador y correo de prueba sin coincidencia devuelven cero pedidos, y teléfono vacío rechazado con 400 por el servidor.
- Prueba visual del carrito: PayPal se detiene con teléfono vacío y muestra el aviso junto al campo. No se hizo una compra ni se capturó dinero para probar esta funcionalidad; la propagación del teléfono al pago se comprobó con pruebas automatizadas del flujo.

Esta revisión cubre los componentes indicados, no es una prueba exhaustiva de penetración, una auditoría completa de Proax ni una revisión forense de accesos anteriores.
