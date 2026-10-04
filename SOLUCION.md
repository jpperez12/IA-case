# SOLUCION.md — Agente de Órdenes de Compra SAP

## 1. Problema en una frase

La analista administrativa transcribe a mano en SAP cada orden de compra y valida de memoria si el aprobador puede aprobar ese monto en ese centro de costo. Eso le cuesta tiempo a ella, le genera correcciones de cierre a contabilidad y le deja a la dirección sin poder medir cuántas compras se hacen antes de tener OC.

## 2. Arquitectura

```
┌──────────────────┐  POST /api/chat   ┌──────────────────────────────────────────────┐
│ web/index.html   │ ────────────────▶ │ src/server.ts (node:http)                    │
│ chat, tool calls,│ ◀──────────────── │   └─ src/agent/ciclo.ts                      │
│ barra confirmar  │  reply, toolCalls,│        prompt → LLM → herramientas → LLM …   │
└──────────────────┘  needsConfirmation│        ├─ src/llm/adapter.ts (interfaz)      │
                                       │        │    └─ anthropic.ts (implementación) │
                                       │        └─ src/tools/registro.ts (zod + log)  │
                                       │             └─ src/tools/oc.ts (oc_*)        │
                                       │                  └─ src/dominio/ (reglas)    │
                                       │                  └─ src/sap/mock.ts          │
                                       └──────────────┬──────────────────┬────────────┘
                                                      │                  │
                                         fixtures/ (solo lectura)   out/ (escritura)
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, reglas que nunca rompe, flujo, formato de respuesta |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Campos SAP, reglas RC1–RC10, cómo recomendar ante cada excepción |
| **Ejecución** | `src/tools/oc.ts` → `src/dominio/` | Lectura, validación, payload, evidencia, creación. Funciones puras y deterministas |

El servidor no contiene reglas de negocio. Un cambio de umbral (por ejemplo, la tolerancia del 2 %) se hace en `src/dominio/validar.ts` (`PARAMETROS`) sin tocar el servidor ni el ciclo.

## 3. Ciclo del agente

`src/agent/ciclo.ts` ejecuta un turno así:

1. Agrega el mensaje del usuario al historial del modelo.
2. Llama al modelo con el system prompt (comportamiento + conocimiento) y las herramientas. Sus esquemas JSON se derivan de los mismos `zod` que valida el backend, así que hay una sola fuente de verdad.
3. Si el modelo pide herramientas, el registro valida los argumentos con `zod`, ejecuta, registra la llamada en `out/log.jsonl` y devuelve el resultado al modelo. Se repite.
4. Termina cuando el modelo responde sin pedir herramientas.

**Topes.**
- `MAX_ITERACIONES` (25) por turno. En la última iteración se avisa al modelo y la siguiente llamada se hace con `tool_choice: none`, para que responda con lo que tiene y lo que falta (CA1).
- `MAX_TOKENS_SESION` corta la sesión con un mensaje claro.
- `LLM_TIMEOUT_MS` aborta la llamada al proveedor.

**Confirmación humana (CA3).** No depende solo del prompt; la garantiza el backend:

- Si en un turno `oc_crear` quedó pendiente de confirmación, la sesión queda en estado `esperaConfirmacion` y el front muestra la barra ámbar.
- En el turno siguiente, el ciclo evalúa el mensaje del usuario. Solo si es una afirmación explícita ("confirmo", "sí, créala") y no contiene negaciones, pasa `ctx.confirmacionUsuario = true` a las herramientas.
- `oc_crear` con `confirmado: true` se rechaza si ese indicador no viene del ciclo. El modelo no puede confirmarse a sí mismo aunque lo intente. `scripts/prueba-ciclo.ts` lo verifica.

**Errores (CA5).** Un error del proveedor descarta el turno incompleto del historial del modelo, se informa en lenguaje claro y la sesión sigue utilizable. Un error de herramienta vuelve al modelo como `{ ok: false, error }` para que lo explique.

## 4. Elección del modelo

| | |
|---|---|
| Proveedor | Anthropic (API de Mensajes, vía `fetch`, sin SDK) |
| Modelo | `claude-sonnet-4-6`, configurable con `LLM_MODEL` |
| Por qué | Uso de herramientas confiable en flujos de varios pasos, buen español de negocio y caché de prompt, que abarata el system prompt y las herramientas repetidas en cada iteración |

**Costo estimado por caso.**

- El system prompt más las herramientas suman unos 3.000 tokens, y un caso típico usa 5 o 6 llamadas al modelo.
- En total son unos 27.000 tokens de entrada, de los cuales unos 18.000 se leen de caché a 10 % del precio, y unos 1.500 de salida.
- A los precios de lista de Sonnet 4.6 (USD 3 por millón de entrada y USD 15 por millón de salida), queda en **≈ USD 0,05–0,10 por caso**.
- Con `claude-haiku-4-5` sería cerca de un tercio, con algo menos de calidad en la redacción de recomendaciones.

El consumo real queda en `sesion.tokens`.

## 5. Matriz de controles

Todas las reglas viven en `src/dominio/validar.ts`, una función por regla, con un resultado tipado `{ codigo, detalle, accion_sugerida, valores }`. `validar()` es pura: el mismo paquete y los mismos maestros dan siempre el mismo resultado.

| Regla | Implementación | Caso que la prueba |
|---|---|---|
| RC1 | Busca por NIT normalizado (sin puntos ni dígito de verificación); sin NIT, por nombre normalizado (sin tildes, puntuación ni sufijo S.A.S./Ltda.). Exige `activo` | sol-002 bloqueada; sol-006 encontrada por nombre |
| RC2 | Exige aprobación, la palabra "Aprobado" no negada y un remitente listado en el centro. Si no lo está, dice dónde sí aprueba ese correo | sol-003 bloqueada |
| RC3 | Valor total ≤ tope del aprobador. Sugiere a quién escalar o dice que nadie del centro tiene tope | — |
| RC4 | Subárea dentro del centro de costo | — |
| RC5 | Diferencia relativa > 2 %, moneda distinta o cotización ausente generan una confirmación con ambos valores | sol-004 |
| RC6 / RC7 | IVA y condiciones de pago faltantes se derivan del proveedor. El IVA pide confirmación; la condición de pago solo se informa. Un código inexistente en el maestro bloquea | sol-006 |
| RC8 | Factura anterior a la solicitud: confirmación y `retroactiva = true` en `control.csv` | sol-005 |
| RC9 | Fecha local del correo de aprobación ≥ fecha de solicitud | — |
| RC10 | `cantidad × valor_unitario` vs. `valor_total` con tolerancia de ± 1 | — |

**La más difícil fue RC2**, no por el código sino por la recomendación. En `sol-003`, Felipe Vargas aprueba un gasto de CC-2020 donde no es aprobador. El bloqueo es obvio; lo valioso es lo que el agente sugiere. La herramienta muestra que Felipe sí aprueba en CC-3030 con tope suficiente, y que ningún aprobador de CC-2020 tiene tope para $74M. El correo dice que el mobiliario es para el equipo de preventa, así que el error probable es el centro de costo, no el aprobador. El agente lo propone, pero nunca cambia el centro por su cuenta.

## 6. Diseño del adaptador SAP real

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`, expuesto a través de SAP Integration Suite o API Management.** Si el sistema resulta ser ECC, la alternativa es RFC con `BAPI_PO_CREATE1` detrás del mismo Integration Suite.

Como la viabilidad no está confirmada, lo primero es confirmar con el equipo BASIS la versión de SAP (S/4HANA o ECC) y si existe Cloud Connector. La interfaz `SapAdapter` no cambia en ningún caso: solo cambia la implementación.

- Con OData no hace falta un conector propietario en el agente, la creación del encabezado con sus posiciones es atómica (una sola operación de inserción profunda) y se puede gobernar con API Management (cuotas, auditoría).
- En S/4HANA Cloud se habilita con el escenario de comunicación de integración de órdenes de compra.

**Mapeo principal.**

| Payload 7.4 | Campo OData |
|---|---|
| `sociedad` / `organizacion_compras` | `CompanyCode` / `PurchasingOrganization` |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` / `condiciones_pago` | `DocumentCurrency` / `PaymentTerms` |
| — | `PurchaseOrderType` = `NB` y `PurchasingGroup` (a definir con compras) |
| `posiciones[].numero` / `descripcion` | `PurchaseOrderItem` / `PurchaseOrderItemText` (40 caracteres) |
| `cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` (con tabla de equivalencias: `H` → unidad de horas configurada, `UN` → unidad local) |
| `precio_unitario` | `NetPriceAmount`. **Ojo:** SAP espera precio neto. La solicitud trae el precio con IVA incluido, así que se divide por (1 + tasa del indicador) |
| `indicador_iva` | `TaxCode` |
| `centro_costo` | Imputación `K` con `CostCenter` en la asignación contable de la posición |
| `subarea` | No es un campo estándar: va como texto de posición o en un campo Z acordado con SAP |
| `referencia.solicitud_id` | Un campo de referencia del encabezado (por ejemplo, la referencia interna de correspondencia), que sirve para la idempotencia |
| `aprobador` + evidencia | El PDF se adjunta con el servicio de adjuntos de SAP después de crear la OC; el sha256 va en un texto de encabezado |

**Autenticación.**

- OAuth 2.0 con credenciales de cliente o un usuario técnico de comunicación con permisos mínimos (solo crear y leer OC).
- Las credenciales viven en un gestor de secretos (Azure Key Vault o el almacén de Integration Suite) y las lee únicamente el adaptador en el backend.
- Nunca pasan por el agente, el prompt, los logs ni el front.

**Idempotencia y errores parciales.**

- Antes de crear, el adaptador busca una OC con la referencia de la solicitud. Si existe, devuelve su número, como hace hoy el mock.
- La creación de encabezado con posiciones es atómica: o queda todo o no queda nada. Con BAPI se hace `BAPI_TRANSACTION_COMMIT` solo si el retorno no trae errores; si los trae, `ROLLBACK`.
- El paso que sí puede fallar parcialmente es el adjunto, porque la OC ya existe. En ese caso la OC se marca `evidencia_pendiente` en el control y se reintenta solo el adjunto, nunca la creación.
- Los reintentos ante timeouts siempre pasan primero por la búsqueda por referencia.

**Plan B si no hay conexión.** El agente sigue ahorrando todo el trabajo de validación y casi toda la digitación:

1. **OC lista para pegar:** la vista campo a campo en el orden de la transacción ME21N, con valores ya validados y el PDF de evidencia listo para adjuntar.
2. **Archivo de carga masiva:** un CSV diario con todas las OC aprobadas, en la plantilla del cockpit de migración o LSMW, cargado por una persona con su usuario.
3. **Control intacto:** `control.csv` sigue midiendo retroactivas y bloqueos, que es lo que la dirección quiere ver.

## 7. Lectura del proceso: OC retroactivas

Una OC retroactiva significa que la compra se decidió, se ejecutó y se facturó sin que nadie de compras la viera antes. El control llega cuando ya no puede cambiar nada: no se negoció precio, no se comparó proveedor y el aprobador firma algo que ya está pagado o por pagar.

El caso `sol-005` lo muestra con claridad:
- La cotización es del 5 de agosto y la factura del 10.
- La solicitud se hizo el 27 y la aprobación el 28, con un correo que pide "crear la OC para poder radicar la factura".
- La OC funcionó como trámite para pagar, no como control.

Mi propuesta a la dirección:

1. **Medir antes de prohibir.** El agente ya marca cada OC retroactiva en `control.csv`. Con un mes de datos se sabe el porcentaje real, por centro de costo, por solicitante y por proveedor. La conversación cambia de anécdotas a cifras.
2. **Fijar una política explícita**, que hoy no existe (es la pregunta abierta del PRD). Una opción razonable: tolerarlas con marca para montos menores a un umbral y en categorías recurrentes como papelería; por encima del umbral, exigir aprobación de un nivel superior al habitual.
3. **Atacar la causa: la OC llega tarde porque crearla es lento.** Si con el agente una OC sale en minutos, el incentivo a comprar primero y regularizar después baja. El indicador de éxito es el porcentaje de OC retroactivas mes a mes.
4. **Cerrar la puerta de salida.** Con los proveedores recurrentes, acordar que no se radica factura sin número de OC. Esto convierte la regla en parte del proceso de pago.

## 8. Decisiones y trade-offs

1. **Las herramientas releen todo del disco; lo que envía el modelo solo se verifica.**
   - `oc_validar`, `oc_construir_payload` y `oc_crear` aceptan `paquete`, `derivados` y `payload` por contrato, pero solo los comparan con lo leído.
   - En `oc_crear`, un payload distinto al construido se rechaza; el demo lo prueba con un precio alterado.
   - Descarté usar como fuente el objeto que pasa el modelo: es más simple, pero abre la puerta al riesgo de la sección 10 (que el modelo "arregle" un monto).
   - Costo: cada herramienta vuelve a leer unos pocos archivos JSON, algo despreciable.
2. **La confirmación humana se garantiza en el backend, no solo en el prompt.**
   - Descarté dejarla solo en el prompt, porque un prompt se puede saltar con una instrucción ambigua o una alucinación.
   - Costo: el reconocimiento de "sí" es por expresiones. Una confirmación muy indirecta puede no reconocerse, y en ese caso el agente vuelve a preguntar. Es el error seguro.
3. **Extracción determinista (regex) de cotización y factura, no con el modelo.**
   - El total y las fechas alimentan controles de bloqueo, así que deben ser reproducibles y testeables en `demo.ts`.
   - Descarté extraerlos con el LLM: toleraría formatos más variados, pero rompe el determinismo y deja de servir sin clave.
4. **`fetch` directo a la API en lugar del SDK.** Una dependencia menos y control total del timeout y de los mensajes de error. El costo es mantener los tipos mínimos de la API a mano.
5. **`node:http` en lugar de un framework.** Son seis rutas. Funciona igual en Bun y en Node, y no suma dependencias.
6. **Renderizado de markdown propio en el front.** Primero usé librerías por CDN. Las cambié porque, si el CDN falla durante la defensa, el chat no muestra respuestas. El renderizador escapa todo el HTML antes de formatear, así que es seguro por construcción.
7. **Precios con IVA incluido en el payload, igual que la solicitud.** Es fiel a los fixtures, que dan los precios así. En el adaptador real se convierten a precio neto (sección 6).

## 9. Supuestos

- El caso se identifica por la carpeta (`sol-001`). La idempotencia usa `solicitud_id` (`SOL-2026-001`).
- Fuentes de trazabilidad: además de `solicitud`, `cotizacion`, `maestro.<nombre>` y `derivado`, uso `paquete.aprobacion`, `paquete.correo` y `constante`, porque el aprobador y el id del correo no salen de ninguna de las cuatro.
- La fecha de aprobación es la fecha local del correo (los primeros 10 caracteres del ISO con zona -05:00).
- Para RC5 la OC se crea con el valor de la solicitud, que es el aprobado. El de la cotización se muestra para que la analista decida.
- La unidad se infiere de la descripción: horas → `H`, mensual → `MES`, el resto → `UN`. La descripción se recorta a 40 caracteres sin partir palabras ni terminar en un conector; el texto completo queda en la trazabilidad.
- Una cotización ausente es confirmación (RC5), no bloqueo. Una aprobación ausente es bloqueo (RC2).
- Indicadores de IVA o condiciones de pago informados pero inexistentes en el maestro bloquean, aunque el PRD no lo dice explícitamente: SAP los rechazaría igual.
- Cada llamada a `oc_crear` cuenta como intento en `control.csv`, incluidos los bloqueados y pendientes. Por eso el agente la llama también cuando hay bloqueos.

## 10. Cobertura

| Historia | Estado | Nota |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Adjuntos ausentes como `null` + `faltantes`; JSON malformado y montos no numéricos con mensaje claro |
| HU-2 Validar | Hecho | RC1–RC10, con acción sugerida por bloqueo y derivados informados |
| HU-3 Payload | Hecho | Esquema `zod` 7.4 y `trazabilidad.json` por caso |
| HU-4 Evidencia | Hecho (P0 y P1) | `aprobacion.txt` con sha256 y `aprobacion.pdf` con `pdf-lib` |
| HU-5 Crear OC | Hecho | Numeración desde 4500000001, idempotencia y `control.csv` |
| HU-6 Errores | Hecho | `{ ok: false, error }` legible en todas las capas |
| `oc_leer_excel` (P1) | No hecho | Los fixtures traen la solicitud normalizada |
| Streaming (opcional) | No hecho | El front muestra un indicador de "pensando" |
| Bonus `modulo/` | Hecho | Se genera desde las mismas fuentes; `demo.ts` verifica que no diverja |

**Qué falta para producción:**
- leer `.xlsx`, `.pdf` y `.eml` reales;
- adaptador SAP real (sección 6) y maestros consultados en SAP en tiempo real;
- autenticación de usuarios, con la identidad real de quien confirma en `confirmado_por`;
- persistencia de sesiones y control en una base de datos;
- pruebas automatizadas en CI;
- tablero sobre `control.csv`.

## 11. Uso de IA

<!-- Revisar y ajustar a tu experiencia real antes de entregar. -->

Usé **Claude** (claude.ai) como asistente durante todo el reto:

- **Lectura y elección del reto:** comparé los tres PRD y elegí el 03 por tener reglas deterministas y casos de prueba explícitos.
- **Diseño:** arquitectura, separación comportamiento / conocimiento / ejecución, y la decisión de que las herramientas sean la única fuente de valores.
- **Código:** dominio, herramientas, ciclo, servidor y front, construidos por capas y verificados en cada paso con `demo.ts`, `scripts/prueba-ciclo.ts` y `tsc` en modo estricto.
- **Documentación:** README y este documento.

Lo que se descartó o corrigió de lo propuesto:

- Confiar en el payload que envía el modelo: se cambió por releer y comparar (decisión 1).
- Librerías de markdown por CDN: se reemplazaron por un renderizador propio (decisión 6).
- El primer recorte de la descripción a 40 caracteres dejaba textos como "…para la mesa de": se corrigió para no terminar en conectores.
- La primera recomendación de RC2 en `sol-003` no decía que ningún aprobador de CC-2020 tenía tope suficiente; se agregó.

Revisé cada archivo y puedo explicar cada línea.

## 12. Riesgos de llevar esto a producción

| Riesgo | Mitigación |
|---|---|
| El modelo altera un monto o un código | Las herramientas son la única fuente de valores y `oc_crear` rechaza payloads distintos al construido |
| Confirmación falsa ("sí" ambiguo o del propio modelo) | La confirmación la decide el backend con el mensaje del usuario; en producción, además, un botón con identidad autenticada |
| Formatos reales de cotización muy variados | Mantener la extracción determinista para total y fechas; usar el modelo solo como respaldo con confianza baja, que siempre pida confirmación |
| Maestros desactualizados | Consultar proveedor y centro en SAP en tiempo real con el mismo adaptador |
| Correo de aprobación falsificado | Validar el remitente con los encabezados del correo (DKIM/SPF) o mover la aprobación a un flujo con firma; auditoría puede exigir firma digital |
| Costo descontrolado de la clave | Topes de iteraciones, tokens por sesión y respuesta, y clave de acceso al link; en producción, límites por usuario |
| Datos personales en logs | Los logs guardan argumentos recortados y resúmenes; en producción, retención definida y enmascaramiento de correos |
| Inyección de instrucciones dentro de un correo o cotización | El texto del paquete es solo dato; las acciones con efecto pasan por reglas deterministas y confirmación humana |
