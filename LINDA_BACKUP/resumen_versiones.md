# Resumen de Versiones — Árbol de Evolución

## Familia: Dashboard Espartanos

```
cobranza_dashboard.html          MAR-05  39 KB  ❌ obsoleto
cobranza_dashboard (2).html      MAR-05  33 KB  ❌ obsoleto
cobranza_dashboard (3).html      MAR-05  33 KB  ❌ obsoleto
cobranza_dashboard (4).html      MAR-06  39 KB  ❌ obsoleto
Espartanos_Dashboard_v2.html     MAR-24  56 KB  ❌ obsoleto
Espartanos_Dashboard_v2 (1).html MAR-24  69 KB  ❌ obsoleto
Espartanos_Dashboard_v2 (2).html MAR-25  70 KB  ❌ obsoleto
Espartanos_Dashboard_v3.html     MAR-25  89 KB  ❌ obsoleto
Espartanos_Dashboard_v5.html     ABR-01 132 KB  ✅ ACTIVO
```

## Familia: Front Operativo

```
Espartanos_Front_Operativo_v6_4-1.html  ABR-01  77 KB  ❌ obsoleto
Espartanos_Front_Operativo_v6_6.html    ABR-03  97 KB  ✅ ACTIVO
```

## Familia: Gestión de Campo

```
Espartanos_GestionCampo_Octavio_V2.html  ABR-04  49 KB  ❌ obsoleto
Espartanos_GestionCampo_v3.1.html        ABR-16  81 KB  ✅ ACTIVO (más reciente)
```

## Familia: Rutas / Navegación

```
Ruta_Navegacion_Espartanos.html       ABR-02  97 KB  ❌ obsoleto
Ruta_Navegacion_Espartanos_1.html     ABR-02 117 KB  ❌ obsoleto
Ruta_Navegacion_Espartanos.1.1.html   ABR-03 118 KB  ✅ ACTIVO
Ruta_ViernesSanto_Octavio_QRO.html    ABR-03  27 KB  ℹ️ especial (Viernes Santo)
```

## Familia: Monolítico Espartanos (referencia histórica)

```
espartanos_cobranza_qro.html   MAR-06 286 KB  ❌ obsoleto
cobranza_qro_norte.html        MAR-06  58 KB  ❌ obsoleto
espartanos_v2_FINAL.html       MAR-15 445 KB  ℹ️ REFERENCIA (no usar en prod)
```

---

## Lógica Reutilizable Detectada en HTML

### Para integrar en Supabase

| Lógica HTML | Columna Supabase equivalente |
|-------------|-----------------------------|
| Filtro bucket (1-30, 31-60, 61-90) | `cuentas_cobranza.bucket` |
| Filtro por gestor | `gestiones.agente` |
| Filtro por colonia (multi-select) | `cuentas_cobranza.colonia` |
| Barra de arrastre (meta vs real) | vista `v_campana_activa` |
| Score por comportamiento | `cuentas_cobranza.comportamiento_historico` |
| Rutas por día (L-V) | tabla `rutas_campo` (pendiente crear) |

### Para integrar en n8n

| Lógica HTML | Workflow n8n |
|-------------|-------------|
| Priorizar cuentas por bucket + comportamiento | W2 nodo `Tel + Modelo` |
| Cuentas sin gestión en 24h | W2 query Supabase `ultima_wa` |
| Segmentación empático/firme/presión | W1 y W2 nodo `Preparar + Modelo` |
| Promesas vencidas (fecha < hoy) | W3 query `v_promesas_vencidas` |

### Para mejorar prompts IA

- El HTML usa **3 segmentos de color** (verde/ámbar/rojo) que mapean exactamente a los 3 modelos
- Las métricas clave son: `efectividad_%`, `pagos_recibidos`, `monto_recuperado`, `promesas_cumplidas`
- Los gestores tienen metas individuales — considerar agregar nombre del gestor al prompt de presión
