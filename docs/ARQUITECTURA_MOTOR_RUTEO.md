# Motor de Ruteo Inteligente — Arquitectura Enterprise
### Sistema de Cobranza Campo · Espartanos QRO Norte · Libertad Financiera

---

## PRINCIPIO RECTOR

> El sistema no genera rutas. Genera decisiones territoriales con fundamento operativo, geográfico y crediticio.

La diferencia es que un generador de rutas sabe dónde ir. Este motor sabe **por qué ir ahí primero, qué recoger de paso, cuándo recalcular y cómo no dejar nada sin cubrir.**

---

## 1. ARQUITECTURA MODULAR

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MOTOR DE RUTEO INTELIGENTE                       │
│                     Espartanos QRO · v1.0                          │
└─────────────────────────────────────────────────────────────────────┘

 CAPA 1: INGESTA Y LIMPIEZA
 ┌──────────────────────────────────────────────────────────────────┐
 │  M1.1 Parser de entrada       M1.2 Normalizador textual          │
 │  M1.3 Deduplicador            M1.4 Homologador de direcciones    │
 │  M1.5 Validador semántico     M1.6 Manejador de ambigüedad       │
 └──────────────────────────────────────────────────────────────────┘
                              ↓
 CAPA 2: GEOCODIFICACIÓN
 ┌──────────────────────────────────────────────────────────────────┐
 │  M2.1 Geocodificador primario  M2.2 Geocodificador fallback      │
 │  M2.3 Asignador de precisión   M2.4 Score de confianza          │
 │  M2.5 Validador geográfico     M2.6 Degradación elegante        │
 └──────────────────────────────────────────────────────────────────┘
                              ↓
 CAPA 3: SCORING CREDITICIO
 ┌──────────────────────────────────────────────────────────────────┐
 │  M3.1 Clasificador de segmento M3.2 Evaluador de comportamiento  │
 │  M3.3 Calculador de score      M3.4 Ponderador de monto vencido  │
 └──────────────────────────────────────────────────────────────────┘
                              ↓
 CAPA 4: INTELIGENCIA TERRITORIAL
 ┌──────────────────────────────────────────────────────────────────┐
 │  M4.1 Clustering geográfico    M4.2 Detector de corredores      │
 │  M4.3 Score de zona            M4.4 Detector de cuentas de paso │
 │  M4.5 Analizador de densidad   M4.6 Evaluador de compactación   │
 └──────────────────────────────────────────────────────────────────┘
                              ↓
 CAPA 5: MOTOR DE DECISIÓN Y RUTEO
 ┌──────────────────────────────────────────────────────────────────┐
 │  M5.1 Receptor de posición GPS M5.2 Selector de zona óptima     │
 │  M5.3 Insertador de paso       M5.4 Ordenador interno de zona   │
 │  M5.5 Generador de secuencia   M5.6 Recalculador dinámico       │
 └──────────────────────────────────────────────────────────────────┘
                              ↓
 CAPA 6: EJECUCIÓN Y RETROALIMENTACIÓN
 ┌──────────────────────────────────────────────────────────────────┐
 │  M6.1 Registrador de visita    M6.2 Actualizador de estado      │
 │  M6.3 Trigger de recálculo     M6.4 Monitor de cobertura total  │
 │  M6.5 Logger de decisiones     M6.6 Auditoría de ruta           │
 └──────────────────────────────────────────────────────────────────┘
```

---

## 2. FLUJO END-TO-END

```
INPUT (archivo de cuentas)
  │
  ▼
M1: INGESTA Y NORMALIZACIÓN
  │  Parseo, limpieza textual, homologación de abreviaturas,
  │  detección de duplicados, generación de dirección canónica
  ▼
M2: GEOCODIFICACIÓN EN CASCADA
  │  Dirección completa → Calle → Colonia → CP → Municipio
  │  Nunca excluye una cuenta. Siempre asigna coordenadas.
  ▼
M3: SCORING CREDITICIO
  │  Segmento de mora + Comportamiento histórico + Monto vencido
  │  → Score de urgencia (componente estático)
  ▼
M4: CLUSTERING TERRITORIAL
  │  DBSCAN → agrupación jerárquica → detección de corredores
  ▼
M5: SCORE DE ZONA
  │  Peso crediticio agregado + Densidad + Cercanía + Compactación
  ▼
M6: DECISION ENGINE
  │  Posición GPS del usuario → Zona óptima → Cuentas de paso
  ▼
M7: BARRIDO INTERNO
  │  Ordenar visitas dentro de la zona: misma calle → paralelas
  │  Mezcla prioridad crediticia con continuidad geográfica
  ▼
  [USUARIO EN CAMPO]
  │
  ▼
M8: CONTEXT TRACKER
  │  Registrar visita / no localizado / reprogramado / nueva posición
  ▼
M9: RECÁLCULO DINÁMICO (si hay evento)
  │  Recálculo incremental desde posición actual
  ▼
  [¿Cobertura total?] → NO: volver a M6
                      → SÍ: Reporte de jornada
```

---

## 3. SEGMENTOS DE MORA OFICIALES

| Segmento | Días | Prioridad macro |
|---|---|---|
| 91-120 | 91 a 120 | 1 — CRÍTICA |
| 61-90 | 61 a 90 | 2 — ALTA |
| 31-60 | 31 a 60 | 3 — MEDIA |
| 16-30 | 16 a 30 | 4 |
| 8-15 | 8 a 15 | 5 |
| 1-7 | 1 a 7 | 6 |
| 0 días | 0 (interés ordinario) | 7 — MÍNIMA |

---

## 4. REGLAS DE NEGOCIO FORMALIZADAS

### REGLA-001: COBERTURA TOTAL
Toda cuenta debe terminar en estado: `visitada` | `reprogramada_con_criterio`.
NUNCA: ignorada | descartada | perdida.

### REGLA-002: PRIORIDAD ABSOLUTA 91-120
Ningún criterio geográfico puede desplazar una cuenta 91-120 si está a menos de 5km del usuario. Debe insertarse en la ruta activa.

### REGLA-003: JERARQUÍA DE SEGMENTOS
```
91-120 > 61-90 > 31-60 > 16-30 > 8-15 > 1-7 > 0 días
```
Esta jerarquía es el techo de la priorización. Dentro de cada segmento aplican reglas secundarias.

### REGLA-004: COMPORTAMIENTO EN SEGMENTOS TEMPRANOS (1-7, 8-15, 16-30)
El `comportamiento_historico` es el criterio principal interno.
Orden: `malo > regular > bueno`
El monto vencido actúa solo como desempate secundario.

### REGLA-005: COMPORTAMIENTO EN 31-60
1. Comportamiento histórico (malo > regular > bueno)
2. Monto vencido (mayor primero)
Respetando geografía cuando el diferencial de score es menor a 15 puntos.

### REGLA-006: CUENTAS 0 DÍAS
Se enrutan siempre. Prioridad mínima.
Excepción: se suben en orden si están en zona activa, corredor de paso, o el costo marginal de visitarlas es mínimo.

### REGLA-007: BARRIDO DE PASO
Si una cuenta está a ≤ umbral_desvío(segmento) del corredor activo, se inserta en la ruta sin importar su prioridad base.

Umbrales de desvío aceptable por segmento:
```
91-120 → 800m   (se desvía hasta 800m para no perderse una crítica)
61-90  → 600m
31-60  → 400m
16-30  → 250m
8-15   → 200m
1-7    → 150m
0 días →  80m
```

### REGLA-008: ZONAS A MEDIAS
No abandonar una zona con >30% pendiente sin criterio explícito.
El sistema penaliza en score dejar zonas incompletas.

### REGLA-009: DEGRADACIÓN DE GEOCODING
Ninguna cuenta queda fuera de la ruta por mala dirección.
Se asigna al clúster del nivel de precisión alcanzado (colonia, CP, municipio).

### REGLA-010: SALTO DE ZONA
Solo se justifica saltar a otra zona si el score de la zona destino supera en >25 puntos el score de continuar en la zona actual.

---

## 5. NORMALIZACIÓN Y HOMOLOGACIÓN DE DIRECCIONES

### Pipeline de normalización
```
Texto crudo
  → lowercase + eliminar acentos (NFD)
  → expandir abreviaturas (c. → calle, av. → avenida, col. → colonia...)
  → colapsar espacios múltiples
  → eliminar prefijos de colonia para comparación
  → dirección canónica (para caché de geocodificación)
```

### Diccionario de abreviaturas principales
```
c. / cll.     → calle
av. / avda.   → avenida
blvd.         → boulevard
fracc.        → fraccionamiento
col.          → colonia
priv.         → privada
prol.         → prolongacion
carr.         → carretera
calz.         → calzada
mz. / mza.    → manzana
lt.           → lote
s/n           → sin numero
nte. / ote. / pte. → norte / oriente / poniente
```

### Score de similitud entre direcciones (Jaro-Winkler)
```
score = (jaro_winkler × 0.6) + (token_set_ratio × 0.4)

Umbrales:
  ≥ 0.92 + misma colonia  → mismo domicilio (duplicado)
  ≥ 0.85 + mismo CP       → probable homólogo
  ≥ 0.75 + distancia GPS < 50m → equivalente geográfico
```

---

## 6. GEOCODIFICACIÓN EN CASCADA

```
INTENTO 1: Dirección completa → Nivel 1 (exacto), score 1.00
INTENTO 2: Calle + colonia + municipio (sin número) → Nivel 2, score 0.85
INTENTO 3: Colonia + municipio + CP → Nivel 3, score 0.45
INTENTO 4: CP + municipio → Nivel 4, score 0.30
INTENTO 5: Solo municipio → Nivel 5, score 0.15
INTENTO 6: Centroide local hardcodeado → Nivel 5, score 0.05

NUNCA falla — siempre retorna coordenadas con nivel de confianza.
```

**Proveedor primario:** Google Maps Geocoding API
**Caché:** tabla `geocoding_cache` en Supabase (evita rellamar a Google)

---

## 7. CLUSTERING TERRITORIAL

### Algoritmo
- **Fase 1:** DBSCAN (epsilon=80m, minPts=1) → microgrupos por cuadra
- **Fase 2:** Aglomerativo jerárquico (umbral=400m) → microzonas
- **Fase 3:** K-means adaptativo (k = √(n/15)) → clústeres de trabajo

### Jerarquía
```
Nivel 5: Municipio
  Nivel 4: Clúster principal (K-means)
    Nivel 3: Microzona (aglomerativo 400m)
      Nivel 2: Cuadra / misma calle (DBSCAN 80m)
        Nivel 1: Cuenta individual
```

### Detección de corredores naturales
Un corredor existe cuando:
- Dos clústeres separados por < 800m
- Al menos 1 cuenta en el trayecto entre ambos
- Desvío desde ruta directa < 20% de distancia adicional

---

## 8. MODELO DE SCORING

### 8.1 Score de Cuenta (0–100)

```
SCORE_CUENTA =
  (A × peso_A)   ← segmento de mora
  (B × peso_B)   ← comportamiento histórico
  (C × peso_C)   ← monto vencido
  (D × 0.20)     ← componente geográfico (dinámico)
  + bonus        ← de paso, zona activa, dirección confiable

Pesos según segmento:
  Segmentos tempranos (1-7, 8-15, 16-30):
    peso_A = 0.25  (segmento)
    peso_B = 0.40  (comportamiento — criterio principal)
    peso_C = 0.05  (monto — solo desempate)

  Segmentos críticos (31-60, 61-90, 91-120):
    peso_A = 0.45  (segmento — criterio principal)
    peso_B = 0.30  (comportamiento)
    peso_C = 0.15  (monto vencido)
```

#### Tabla de pesos por segmento
| Segmento | Puntaje A |
|---|---|
| 91-120 | 40 |
| 61-90 | 33 |
| 31-60 | 24 |
| 16-30 | 15 |
| 8-15 | 9 |
| 1-7 | 4 |
| 0 días | 1 |

#### Tabla de comportamiento histórico
| Comportamiento | Puntaje B |
|---|---|
| malo | 25 |
| regular | 15 |
| bueno | 7 |

#### Componente geográfico (D) — dinámico, recalcula con cada movimiento
```
≤ 100m → 20 pts
≤ 300m → 17 pts
≤ 600m → 13 pts
≤ 1km  →  9 pts
≤ 2km  →  5 pts
≤ 5km  →  2 pts
> 5km  →  0 pts
```

#### Bonus contextuales
```
+10 → cuenta de paso (está en el corredor activo)
+15 → cuenta en la zona activa actual
+3  → dirección con nivel de precisión 1 o 2
+5  → cuenta en segmento 91-120
```

---

### 8.2 Score de Zona (0–100)

```
SCORE_ZONA =
  (A × 0.35)  ← peso crediticio agregado de cuentas pendientes
  (B × 0.20)  ← volumen de cuentas
  (C × 0.25)  ← cercanía al usuario
  (D × 0.10)  ← compactación territorial
  + bonus     ← presencia de cuentas 91-120
  - penalización ← zona a medias / dispersión

Bonus: +20 pts si la zona tiene cuentas 91-120 pendientes
Penalización: -15 pts si la zona está parcialmente trabajada (>0% y <100%)
```

#### Cercanía al usuario (C)
```
≤ 0.5km → 100
≤ 1.0km →  85
≤ 2.0km →  65
≤ 4.0km →  45
≤ 8.0km →  25
≤ 15km  →  10
> 15km  →   2
```

---

## 9. REGLAS DE DESEMPATE

### Desempate de cuenta (diferencia < 3 puntos de score)
1. Menor distancia al punto actual
2. Mayor monto vencido
3. Peor comportamiento histórico
4. Mayor días de mora
5. ID de cuenta (determinístico)

### Desempate de zona
1. Mayor volumen de cuentas pendientes
2. Mayor densidad territorial
3. Presencia de cuentas 91-120
4. Menor distancia al usuario
5. cluster_id (determinístico)

---

## 10. LÓGICA DE BARRIDO INTERNO

Una vez que el usuario entra a una zona, el orden de visitas sigue este criterio:

1. Agrupar cuentas por calle
2. Ordenar calles por proximidad al punto de entrada
3. Dentro de cada calle: ordenar por score crediticio
4. Si la diferencia de score entre dos cuentas es < 20 pts → priorizar distancia (evitar zigzag)
5. Si la diferencia es > 20 pts → priorizar score crediticio aunque implique algo de zigzag

---

## 11. RECÁLCULO DINÁMICO

### Eventos que disparan recálculo

| Evento | Recálculo |
|---|---|
| Visita completada | Siempre |
| No localizado / reprogramado | Siempre |
| Usuario se desvió > 300m del punto esperado | Sí |
| Zona activa completada | Recálculo completo |
| Nueva cuenta ingresada con score > percentil 70 | Sí |

### Estrategia
- Recálculo **incremental** (no recalcular todo el universo en cada evento)
- Si aún estamos en la misma zona → solo re-ordenar barrido interno
- Si se completó la zona → recálculo completo de scores de zonas restantes

---

## 12. MANEJO DE DATOS INCOMPLETOS

| Escenario | Tratamiento |
|---|---|
| Sin número exterior | Geocodificar por calle + colonia → Nivel 2 |
| Colonia mal escrita | Fuzzy match contra catálogo INEGI → si score > 0.8 corregir |
| CP no existe en municipio | Ignorar CP, usar municipio + colonia |
| Geocoding fallido 3 intentos | Asignar centroide de colonia (Nivel 3) |
| Coordenadas fuera del municipio | Degradar a Nivel 4, re-intentar |
| Duplicado exacto | Merge → conservar ID maestro |
| Posible duplicado (similitud 0.75-0.92) | Flag `posible_duplicado`, GPS decide |
| Días mora nulos | Tratar como 0 días |
| Comportamiento nulo | Asignar 'regular' como default |
| Monto vencido nulo | Tratar como $0 — no usar como criterio |

---

## 13. PSEUDOCÓDIGO MAESTRO

```pseudocode
FUNCTION motor_ruteo_inteligente(archivo_cuentas, posicion_usuario):

  // ===== FASE 1: PREPARACIÓN =====
  cuentas_raw          = ingestar(archivo_cuentas)
  cuentas_normalizadas = normalizar_y_homologar(cuentas_raw)
  cuentas_geocodificadas = geocodificar_cascada(cuentas_normalizadas)
  cuentas_deduplicadas = detectar_y_mergear_duplicados(cuentas_geocodificadas)

  // ===== FASE 2: CLUSTERING =====
  microgrupos = DBSCAN(cuentas_deduplicadas, epsilon=80m, minPts=1)
  microzonas  = clustering_aglomerativo(microgrupos, umbral=400m)
  clusters    = kmeans_adaptativo(microzonas, k=sqrt(n/15))
  corredores  = detectar_corredores(clusters)

  // ===== FASE 3: CONTEXTO INICIAL =====
  contexto = inicializar_contexto(posicion_usuario, cuentas_deduplicadas)

  // ===== BUCLE PRINCIPAL =====
  WHILE cuentas_pendientes(contexto) > 0:

    // Calcular score de todas las zonas
    FOR cada cluster:
      cluster.score = calcular_score_zona(cluster, contexto)

    // Elegir zona siguiente
    zona_objetivo = elegir_siguiente_zona(clusters, contexto)
    zona_objetivo = verificar_override_critico_91_120(zona_objetivo, contexto)

    // Detectar cuentas de paso en el trayecto
    cuentas_paso = detectar_cuentas_de_paso(posicion_actual, zona_objetivo, contexto)

    // Visitar cuentas de paso en el camino
    FOR cada cuenta_paso:
      resultado = registrar_visita(cuenta_paso)
      contexto  = actualizar_contexto(contexto, resultado)
      IF debe_recalcular(evento, contexto):
        recalcular_incremental(contexto)

    // Barrido interno de la zona objetivo
    contexto.cluster_activo = zona_objetivo
    secuencia = ordenar_barrido_interno(zona_objetivo, posicion_actual, contexto)

    FOR cada cuenta en secuencia:
      posicion_usuario = obtener_posicion_gps()
      IF desvio(posicion_usuario) > 300m:
        recalcular_incremental(POSICION_SIGNIFICATIVA, contexto)
        BREAK

      resultado = registrar_visita(cuenta)
      contexto  = actualizar_contexto(contexto, resultado)

  // ===== FIN =====
  RETURN generar_reporte_cobertura(contexto)
```

---

## 14. IMPLEMENTACIÓN POR FASES

### Fase 1 — MVP Funcional ✅ (completada)
- Schema Supabase completo con triggers automáticos
- Módulo de normalización y homologación de direcciones
- Módulo de geocodificación en cascada con caché
- Módulo de scoring crediticio
- API Fastify: ingesta, jornadas, visitas

### Fase 2 — Inteligencia Territorial (siguiente)
- Clustering DBSCAN + aglomerativo
- Score de zona completo
- Decision Engine: selección de zona óptima
- Barrido interno inteligente
- Detección e inserción de cuentas de paso

### Fase 3 — Dinamismo en Tiempo Real
- Recálculo dinámico por eventos GPS
- Tracking de posición del gestor
- Monitor de cobertura en tiempo real
- Dashboard de jornada

### Fase 4 — Evolución Avanzada
- ML para predicción de visitas exitosas por hora/zona
- Asignación multi-gestor optimizada
- Integración con n8n (agentes IA WhatsApp por cuenta no visitada)
- Geocodificación con modelo local entrenado en cartera propia

---

## 15. STACK TÉCNICO

| Capa | Tecnología |
|---|---|
| Base de datos | Supabase (PostgreSQL) |
| Backend | Node.js + Fastify |
| Geocodificación | Google Maps Geocoding API |
| Caché geo | Tabla `geocoding_cache` en Supabase |
| Clustering | DBSCAN + K-means (implementación JS) |
| Deploy | Railway |
| Automatizaciones | n8n Cloud (d1360.app.n8n.cloud) |
| Agentes IA WhatsApp | n8n + Gemini 1.5 Flash + WhatsApp Cloud API |
| App móvil (futuro) | Expo + React Native |

---

## 16. REPOSITORIO

**GitHub:** `jdiegolabram-lgtm/espartanos-cobranza`

```
espartanos-cobranza/
├── server.js
├── supabase/migrations/001_schema_inicial.sql
├── src/
│   ├── config/supabase.js
│   ├── modules/
│   │   ├── normalizacion/index.js
│   │   ├── geocodificacion/index.js
│   │   └── scoring/index.js
│   └── routes/
│       ├── cuentas.js
│       └── jornadas.js
├── n8n/
│   └── workflow_agentes_cobranza.json
└── docs/
    └── ARQUITECTURA_MOTOR_RUTEO.md   ← este archivo
```

---

*Documento generado: Abril 2026*
*Proyecto: Espartanos QRO Norte — Libertad Financiera*
*Autor técnico: Claude (Anthropic) + Diego Labram*
