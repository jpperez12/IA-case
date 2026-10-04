# Proceso de órdenes de compra en Periferia

## Cómo llega una compra

Cada compra llega a compras@ por correo con tres adjuntos: la solicitud (Excel), la cotización del proveedor (PDF) y el correo de aprobación del líder. En algunos casos llega también la factura, señal de que la compra ya ocurrió antes de tramitar la OC.

## Datos de la OC en SAP

| Campo | De dónde sale |
|---|---|
| Proveedor y código SAP | Maestro de proveedores, buscado por NIT (o por nombre si la solicitud no trae NIT) |
| Descripción | Solicitud. SAP admite 40 caracteres en el texto breve; si es más larga se recorta sin partir palabras |
| Cantidad, precio unitario, moneda | Solicitud. Los precios son IVA incluido, como en la cotización |
| Unidad | Derivada de la descripción: horas → H, mensual → MES, resto → UN |
| Centro de costo y subárea | Solicitud, validados contra el maestro |
| Indicador de IVA | Solicitud; si falta, el default del proveedor (requiere confirmación) |
| Condiciones de pago | Solicitud; si faltan, el default del proveedor (solo se informa) |
| Aprobador | Remitente del correo de aprobación, con el sha256 de la evidencia |
| Sociedad / organización de compras | Fijas en 1000 |

## Reglas de control

| Regla | Qué verifica | Efecto |
|---|---|---|
| RC1 | El proveedor existe en el maestro y está activo | Bloqueo |
| RC2 | Hay aprobación, dice "Aprobado" y la envía un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización y solicitud no difieren más de 2 % (o no hay cotización) | Confirmación |
| RC6 | Falta el indicador de IVA y se toma del proveedor | Confirmación |
| RC7 | Faltan condiciones de pago y se toman del proveedor | Solo se informa |
| RC8 | La factura es anterior a la solicitud: OC retroactiva | Confirmación + marca en control |
| RC9 | La aprobación es anterior a la solicitud | Confirmación |
| RC10 | Cantidad × valor unitario = valor total (± 1) | Bloqueo |

## Cómo recomendar ante una excepción

- **Proveedor inexistente o inactivo:** compras debe crear o reactivar el proveedor en SAP con RUT, certificación bancaria y Cámara de Comercio. No se crea la OC con otro proveedor "parecido".
- **Aprobador sin autoridad en el centro:** puede que el aprobador sea válido pero el centro de costo esté mal. Si el texto de la aprobación o la descripción sugieren otro centro (por ejemplo, el gasto es de un equipo de otra área), propón corregir la solicitud; si no, pedir la aprobación al aprobador correcto del centro. Nunca cambias el centro de costo por tu cuenta.
- **Monto sobre el tope:** escalar al aprobador del centro con tope suficiente; si no hay ninguno, a dirección.
- **Cotización distinta a la solicitud:** la OC se crea con el valor aprobado (el de la solicitud). Si el proveedor va a facturar el valor cotizado, la factura no cuadrará con la OC; lo correcto es una nueva aprobación por el valor cotizado. Menciona esta consecuencia al pedir la confirmación.
- **OC retroactiva:** se puede crear con confirmación, pero queda marcada. Es un desvío del proceso que la dirección quiere medir: la compra se hizo sin OC previa.

## Maestros

- Centros de costo: CC-1010 Tecnología, CC-2020 Administración, CC-3030 Comercial, cada uno con sus subáreas y aprobadores con tope.
- Indicadores de IVA: C0 excluido, C1 19 %, C2 5 %.
- Condiciones de pago: Z000 inmediato, Z015, Z030 y Z060 días fecha factura.

Los valores exactos siempre se consultan con las herramientas; esta lista es solo para orientarte al explicar.
