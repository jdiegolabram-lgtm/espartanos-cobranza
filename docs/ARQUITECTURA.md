# 🦅 Arquitectura · Espartanos Cobranza

> Documento complementario al [README principal](../README.md) y al [README de L.I.N.D.A.](../LINDA/README.md).
> Describe la **capa de tracking operativo** que se suma sobre el motor de ruteo y el agente L.I.N.D.A. existentes.

---

## 📑 Tabla de contenido

1. [Visión general](#-visión-general)
2. [Ecosistema Libertad](#-ecosistema-libertad)
3. [Lógica de negocio](#-lógica-de-negocio)
4. [Arquitectura en capas](#-arquitectura-en-capas)
5. [Mapa del repositorio](#-mapa-del-repositorio)
6. [Módulos nuevos (tracking)](#-módulos-nuevos-tracking)
7. [Endpoints de tablero](#-endpoints-de-tablero)
8. [Exportables](#-exportables)
9. [Integración con el motor de rutas](#-integración-con-el-motor-de-rutas)
10. [Validaciones y riesgos](#-validaciones-y-riesgos)
11. [Roadmap](#-roadmap)

---

## 🧭 Visión general

El sistema de **Libertad Servicios Financieros** combina tres pilares:

| Pilar | Rol | Dónde vive |
|---|---|---|
| 🧠 **L.I.N.D.A.** | Motor analítico + agente conversacional (WhatsApp/IA). Prioriza cartera, detecta rezagos, recomienda acción. | `LINDA/` + `src/modules/linda/` |
| ⚔️ **Espartanos de la Cobranza** | Marco operativo de campo. Disciplina de ejecución, cobertura semanal con corte jueves. | `src/modules/tracking/` (nuevo) |
| 🧭 **Motor de Rutas** (EXISTENTE) | Ruteo territorial por proximidad, clustering, score de zona. **No se reescribe.** | `src/modules/scoring/` + `src/modules/geocodificacion/` |

El **tablero** no es un producto separado: es una **capa de presentación** que consume los tres pilares y genera exportables operativos.

---

## 🌐 Ecosistema Libertad

```
┌──────────────────────────────────────────────────────────────────┐
│                    LIBERTAD · COBRANZA CAMPO                     │
│                                                                  │
│   ┌──────────────┐    ┌───────────────┐    ┌─────────────────┐   │
│   │  gestiones   │──▶ │   L.I.N.D.A.  │──▶ │  Recomendación  │   │
│   │ (tabla base) │    │   (agente)    │    │  + intención    │   │
│   └──────────────┘    └───────┬───────┘    └────────┬────────┘   │
│                               │                     │            │
│                               ▼                     ▼            │
│                     ┌────────────────────┐  ┌───────────────┐    │
│                     │  Priority Engine   │  │ Motor Rutas   │    │
│                     │  (tracking nuevo)  │◀▶│ (scoring geo) │    │
│                     └─────────┬──────────┘  └───────┬───────┘    │
│                               │                     │            │
│                               ▼                     ▼            │
│                    ┌────────────────────────────────────┐        │
│                    │    Tablero + Exportables campo     │        │
│                    └────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Lógica de negocio

### Objetivos de cobranza (en orden)

1. **Recuperar el total del atraso** de la cuenta.
2. Si no es posible, **recuperar mínimo 2 pagos**.
3. **Contener la cuenta** (evitar que avance de segmento).
4. Lograr **gestión total presencial al jueves** de cada semana.
5. **No dejar cuentas sin gestión** al cierre semanal.

### Segmentos de mora (oficiales del sistema)

Los segmentos **ya están definidos** en `supabase/migrations/001_schema_inicial.sql` vía la función `calcular_segmento(dias)` y usados por el módulo de scoring:

| Segmento | Rango de días | Peso crediticio |
|---|---|---|
| `'0'` | Al corriente | 1 |
| `'1-7'` | 1–7 días | 4 |
| `'8-15'` | 8–15 días | 9 |
| `'16-30'` | 16–30 días | 15 |
| `'31-60'` | 31–60 días | 24 |
| `'61-90'` | 61–90 días | 33 |
| `'91-120'` | 91–120 días | 40 |

**Convención Espartanos** (operativa, no reemplaza los segmentos):

- **Temprano** = `'1-7' | '8-15' | '16-30'` → contención, recordatorio, promesa de pago.
- **Medio** = `'31-60'` → negociación activa, visita presencial obligatoria.
- **Crítico** = `'61-90' | '91-120'` → negociación líder, reestructura, cobertura total.

### Motor de prioridad operativa

Vive en `src/modules/priority/` (nuevo). **No reemplaza** al scoring geo/crediticio existente; lo **complementa** con flags operativas:

```
priorityOperativa = scoreCuenta                     ← viene de src/modules/scoring
                  + wStale   · díasSinGestión
                  + wNoVisit · faltaVisitaPresencial
                  + wBroken  · promesaIncumplida
                  − wCoverage · avanceSemanalEjecutivo
```

El **scoring geográfico** (clustering, ruta, proximidad) sigue siendo responsabilidad del motor existente.

### Estructura operativa

| Rol | Persona (seed) | Zona |
|---|---|---|
| Negociador Líder | Ramiro | Querétaro Sur |
| Negociador | Jafet | Querétaro Norte |

Se almacenan en la tabla `gestores` (ya existente).

---

## 🏗️ Arquitectura en capas

El sistema se organiza en **9 capas** con responsabilidades estrictas:

| # | Capa | Responsabilidad | Dónde vive |
|---|------|-----------------|------------|
| 1 | **Ingesta** | Carga de cuentas crudas. | `src/routes/cuentas.js` |
| 2 | **Normalización** | Limpieza de direcciones, IDs, fechas. | `src/modules/normalizacion/` |
| 3 | **Validación** | Reglas de negocio, deduplicación. | Triggers SQL + `normalizacion` |
| 4 | **L.I.N.D.A.** | Agente conversacional + detección de intents. | `src/modules/linda/` + `LINDA/` |
| 5 | **Pendientes** | Cuentas sin gestión, sin visita, con promesa rota. | `src/modules/tracking/` (nuevo) |
| 6 | **Prioridad operativa** | Score final para tablero. | `src/modules/priority/` (nuevo) |
| 7 | **Ruteo** | Clustering + proximidad + orden de visita. | `src/modules/scoring/` + `geocodificacion/` |
| 8 | **Tablero** | Resumen diario, semanal, pendientes, gráficas. | `src/routes/dashboard.js` (nuevo) |
| 9 | **Exportables** | XLSX/CSV por ejecutivo, zona, segmento. | `src/modules/exports/` + `src/routes/exports.js` (nuevo) |

```
  ┌────────────────────────────────────────────────┐
  │               UI / Tablero (Next.js)           │
  └────────────────────────┬───────────────────────┘
                           │
  ┌────────────────────────▼───────────────────────┐
  │           API Fastify (server.js)              │
  │  /api/jornadas · /api/cuentas · /api/gestion   │
  │  /api/promesa · /api/seguimientos · /agent     │
  │  /api/dashboard ✨ · /api/exports ✨            │
  └────┬──────────────┬──────────────┬─────────────┘
       │              │              │
   ┌───▼───┐     ┌────▼────┐    ┌───▼──────────┐
   │ linda │     │ tracking│    │ scoring +    │
   │       │     │ ✨      │    │ geocoding    │
   └───────┘     └────┬────┘    └──────────────┘
                      │
               ┌──────▼──────┐
               │  priority ✨ │
               └─────────────┘
        ✨ = módulos nuevos aditivos
```

---

## 📁 Mapa del repositorio

```
espartanos-cobranza/
├── server.js                          ← entry point Fastify (intacto)
├── package.json                       ← deps actuales (intacto)
├── railway.json                       ← deploy Railway (intacto)
│
├── supabase/
│   └── migrations/
│       ├── 001_schema_inicial.sql     ← motor de ruteo (intacto)
│       └── 002_linda_tables.sql       ← gestiones/promesas/seguimientos (intacto)
│
├── LINDA/                             ← agente L.I.N.D.A. (intacto)
│   ├── README.md
│   ├── SQL/01_schema.sql
│   ├── N8N/W{1..4}_*.json
│   ├── PROMPTS/prompts.md
│   └── DOCS/variables.md
│
├── n8n/                               ← workflows n8n (intacto)
│
├── src/
│   ├── config/supabase.js             ← cliente único (intacto)
│   │
│   ├── modules/
│   │   ├── normalizacion/             ← (intacto)
│   │   ├── geocodificacion/           ← (intacto)
│   │   ├── scoring/                   ← score crediticio + geo (intacto)
│   │   ├── linda/                     ← acciones agente (intacto)
│   │   │
│   │   ├── priority/          ✨       ← motor de prioridad operativa
│   │   ├── tracking/          ✨       ← pipeline diario/semanal
│   │   └── exports/           ✨       ← XLSX/CSV por ejecutivo
│   │
│   └── routes/
│       ├── jornadas.js                ← (intacto)
│       ├── cuentas.js                 ← (intacto)
│       ├── gestion.js                 ← (intacto)
│       ├── promesas.js                ← (intacto)
│       ├── seguimientos.js            ← (intacto)
│       ├── whatsapp.js                ← (intacto)
│       ├── agent.js                   ← (intacto)
│       ├── email.js                   ← (intacto)
│       │
│       ├── dashboard.js       ✨       ← /api/dashboard/*
│       └── exports.js         ✨       ← /api/exports/*
│
└── docs/
    └── ARQUITECTURA.md        ✨       ← este archivo
```

> ✨ = archivos/carpetas **aditivos** creados por esta capa. **Nada preexistente se modifica.**

---

## ⚙️ Módulos nuevos (tracking)

### `src/modules/priority/`

Calcula la **prioridad operativa** de cada cuenta combinando el `score_cuenta` existente con flags de gestión.

```js
const { calculatePriority } = require('./src/modules/priority')

const score = calculatePriority(cuenta, {
  diasSinGestion:        7,
  faltaVisitaPresencial: true,
  promesaIncumplida:     false,
  avanceEjecutivo:       0.42,
})
// score ∈ [0, 100]
```

### `src/modules/tracking/`

Pipeline L.I.N.D.A. de seguimiento diario/semanal.

```js
const {
  runLindaTrackingPipeline,
  buildDailyExecutiveSummary,
  buildWeeklyCoverage,
  getPendingAccounts,
  getBucket,
} = require('./src/modules/tracking')

// Pipeline completo del día
await runLindaTrackingPipeline({ fecha: '2026-04-20' })

// Resumen diario por gestor
const resumen = await buildDailyExecutiveSummary({
  gestorId: '<uuid>',
  fecha:    '2026-04-20',
})

// Acumulado semanal con corte jueves
const cobertura = await buildWeeklyCoverage({
  zona:       'QRO_NORTE',
  semanaISO:  '2026-W16',
})

// Cuentas pendientes accionables
const pendientes = await getPendingAccounts({
  zona:                 'QRO_SUR',
  incluirSinVisita:     true,
  incluirPromesasRotas: true,
})
```

### `src/modules/exports/`

Genera exportables en XLSX/CSV usando `xlsx` (ya en `package.json`).

```js
const { buildExecutiveExport } = require('./src/modules/exports')

const buffer = await buildExecutiveExport({
  gestorId: '<uuid>',
  tipo:     'PENDIENTES_DIA',
  formato:  'xlsx',
})
```

---

## 🔌 Endpoints de tablero

> ⚠️ Los archivos `src/routes/dashboard.js` y `src/routes/exports.js` están listos pero **no se auto-registran en `server.js`**. El ingeniero principal decide cuándo sumarlos con dos líneas:
>
> ```js
> app.register(require('./src/routes/dashboard'), { prefix: '/api/dashboard' })
> app.register(require('./src/routes/exports'),   { prefix: '/api/exports'   })
> ```

### `GET /api/dashboard/daily`

Resumen diario por gestor.

```http
GET /api/dashboard/daily?fecha=2026-04-20&gestor_id=<uuid>
```

**Response 200**
```json
{
  "fecha": "2026-04-20",
  "gestor_id": "...",
  "visitas": 24,
  "promesas": 9,
  "pagos_recibidos": 4,
  "monto_recuperado": 18450.00,
  "cobertura_dia": 0.61
}
```

### `GET /api/dashboard/weekly`

Acumulado semanal con corte jueves.

```http
GET /api/dashboard/weekly?semanaISO=2026-W16&zona=QRO_NORTE
```

### `GET /api/dashboard/pending`

Cuentas pendientes accionables, ya priorizadas.

```http
GET /api/dashboard/pending?zona=QRO_SUR&incluir_sin_visita=true
```

**Response 200** (fragmento)
```json
[
  {
    "cuenta_id":       "...",
    "folio":           "LF-000123",
    "nombre_cliente":  "Juan Pérez",
    "segmento":        "31-60",
    "dias_mora":       47,
    "monto_vencido":   3200.00,
    "prioridad":       87.4,
    "flags": ["SIN_VISITA_PRESENCIAL", "PROMESA_INCUMPLIDA"]
  }
]
```

### `GET /api/exports/pending`

Descarga XLSX de pendientes.

```http
GET /api/exports/pending?gestor_id=<uuid>&formato=xlsx
Accept: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
```

---

## 📤 Exportables

| Reporte | Contenido | Consumidor |
|---|---|---|
| **Pendientes por gestor** | Cuentas priorizadas del día. | Ramiro / Jafet |
| **Pendientes por zona** | QRO Norte / QRO Sur. | Líder de cobranza |
| **Pendientes por segmento** | `1-7` … `91-120`. | Análisis |
| **Cuentas sin gestión** | Universo no tocado en la semana. | Control |
| **Cuentas sin visita presencial** | Faltan visita de campo. | Campo |

---

## 🧭 Integración con el motor de rutas

> ⚠️ El motor de ruteo **ya existe** (`src/modules/scoring/` + `src/modules/geocodificacion/`). **No se reescribe.**
> El tracking operativo le entrega cuentas priorizadas; el motor existente hace el ordenamiento espacial.

Flujo:

1. `tracking.getPendingAccounts()` arma el set de cuentas accionables.
2. `priority.calculatePriority()` les asigna score operativo.
3. El motor de rutas existente (`scoring.calcularScoreCuenta()` con `posicionUsuario`) añade el componente geográfico y orden de visita.
4. El tablero y los exportables consumen el resultado.

---

## ⚠️ Validaciones y riesgos

### Validaciones

| Validación | Dónde | Acción si falla |
|---|---|---|
| Montos negativos, fechas futuras | Triggers SQL + `normalizacion` | Rechazar registro. |
| Segmento inconsistente con `dias_mora` | Trigger `trigger_auto_calcular` | Recalcular con `calcular_segmento`. |
| Cuentas duplicadas | Módulo `normalizacion` + `duplicado_de` | Conservar la versión más reciente. |
| Gestión sin `cuenta_id` o `canal` | Schema Fastify en `routes/gestion.js` | HTTP 400. |

### Riesgos operativos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Datos sucios en `gestiones` | Prioridad mal calculada. | Validación + dashboard de calidad. |
| Duplicidad de visitas | Cobertura aparente inflada. | `visitas` deduplicadas por `(cuenta_id, visitada_at)`. |
| Desacople del motor de rutas | Visitas ineficientes. | Pipeline usa adapter (`scoring.calcularScoreCuenta`) — no reimplementa ruteo. |
| Dashboards no operativos | Líderes no lo usan. | Diseño enfocado a acción: siempre "siguiente cuenta". |

---

## 🛣️ Roadmap

- [ ] Auto-registro de las rutas `dashboard.js` y `exports.js` en `server.js`.
- [ ] Vista materializada `v_pendientes_accionables` para acelerar `/api/dashboard/pending`.
- [ ] Corte semanal automático (cron Railway + n8n) los jueves 20:00.
- [ ] Scoring predictivo (probabilidad de pago) — entrada a `priority`.
- [ ] Geo-fencing: alerta cuando un gestor entra al radio de una cuenta priorizada.

---

## 👥 Responsables

| Rol | Persona |
|---|---|
| Líder de Cobranza Campo | Diego — jdiegolabram@gmail.com |
| Negociador Líder | Ramiro (QRO Sur) |
| Negociador | Jafet (QRO Norte) |

---

> ⚔️ *"Disciplina de Espartanos, inteligencia de L.I.N.D.A., resultados para Libertad."*
