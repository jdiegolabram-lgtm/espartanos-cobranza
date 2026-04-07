-- ============================================================
-- MOTOR DE RUTEO INTELIGENTE — ESPARTANOS COBRANZA
-- Migration 001: Schema inicial
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLA: gestores
-- ============================================================
CREATE TABLE IF NOT EXISTS gestores (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  nombre      VARCHAR(255) NOT NULL,
  email       VARCHAR(255) UNIQUE,
  telefono    TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: jornadas
-- Una jornada = un día de trabajo de un gestor
-- ============================================================
CREATE TABLE IF NOT EXISTS jornadas (
  id                        UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  gestor_id                 UUID REFERENCES gestores(id),
  fecha                     DATE DEFAULT CURRENT_DATE,
  estado                    VARCHAR(20) DEFAULT 'activa'
                              CHECK (estado IN ('activa', 'completada', 'cancelada')),

  -- Posición GPS actual del gestor (se actualiza en tiempo real)
  posicion_lat              DECIMAL(10, 8),
  posicion_lng              DECIMAL(11, 8),
  posicion_actualizada_at   TIMESTAMPTZ,

  -- Métricas de cobertura
  total_cuentas             INTEGER DEFAULT 0,
  cuentas_visitadas         INTEGER DEFAULT 0,
  cuentas_no_localizadas    INTEGER DEFAULT 0,
  cuentas_reprogramadas     INTEGER DEFAULT 0,

  -- Versión de la ruta (se incrementa en cada recálculo)
  ruta_version              INTEGER DEFAULT 0,

  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: cuentas_cobranza
-- Tabla central del motor. Una fila = una cuenta a visitar.
-- ============================================================
CREATE TABLE IF NOT EXISTS cuentas_cobranza (
  id  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  -- Identificación
  folio           VARCHAR(100),
  nombre_cliente  VARCHAR(255),
  telefono        TEXT,
  jornada_id      UUID REFERENCES jornadas(id),

  -- ── Dirección cruda (tal como llega del archivo) ──
  calle_raw             TEXT,
  numero_exterior_raw   TEXT,
  numero_interior_raw   TEXT,
  colonia_raw           TEXT,
  municipio_raw         TEXT,
  codigo_postal_raw     TEXT,
  estado_raw            TEXT,

  -- ── Dirección normalizada (procesada por el motor) ──
  calle_normalizada       TEXT,
  colonia_normalizada     TEXT,
  municipio_normalizado   TEXT,
  codigo_postal_validado  VARCHAR(10),
  direccion_canonica      TEXT,   -- string único para caché de geocoding

  -- ── Geocodificación ──
  lat                 DECIMAL(10, 8),
  lng                 DECIMAL(11, 8),
  -- Nivel 1=exacto, 2=calle, 3=colonia, 4=CP, 5=municipio
  precision_nivel     SMALLINT DEFAULT 5 CHECK (precision_nivel BETWEEN 1 AND 5),
  geocoding_score     DECIMAL(3, 2) DEFAULT 0 CHECK (geocoding_score BETWEEN 0 AND 1),
  fuente_geocoding    VARCHAR(50),
  geocoding_intentos  SMALLINT DEFAULT 0,
  geocoding_respuesta JSONB,

  -- ── Datos crediticios ──
  dias_mora               INTEGER DEFAULT 0,
  segmento                VARCHAR(20),  -- calculado automáticamente por trigger
  comportamiento_historico VARCHAR(10)
                            CHECK (comportamiento_historico IN ('bueno', 'regular', 'malo')),
  monto_vencido   DECIMAL(12, 2) DEFAULT 0,
  saldo_total     DECIMAL(12, 2) DEFAULT 0,
  pago_vencido    DECIMAL(12, 2) DEFAULT 0,

  -- ── Scoring ──
  score_cuenta    DECIMAL(5, 2) DEFAULT 0,  -- score final (incluye geo, recalculable)
  score_urgencia  DECIMAL(5, 2) DEFAULT 0,  -- score estático crediticio

  -- ── Estado operativo ──
  estado_visita   VARCHAR(20) DEFAULT 'pendiente'
                    CHECK (estado_visita IN ('pendiente', 'visitada', 'no_localizada', 'reprogramada')),

  -- ── Clustering ──
  cluster_id        UUID,
  es_cuenta_de_paso BOOLEAN DEFAULT FALSE,
  posicion_en_ruta  INTEGER,

  -- ── Deduplicación ──
  duplicado_de    UUID REFERENCES cuentas_cobranza(id),
  similitud_score DECIMAL(3, 2),

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: clusters_zona
-- Agrupaciones geográficas calculadas por el motor
-- ============================================================
CREATE TABLE IF NOT EXISTS clusters_zona (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  jornada_id  UUID REFERENCES jornadas(id),

  nivel   VARCHAR(20) CHECK (nivel IN ('microzona', 'colonia', 'cluster', 'municipio')),
  nombre  TEXT,

  -- Geografía del cluster
  centroide_lat   DECIMAL(10, 8),
  centroide_lng   DECIMAL(11, 8),
  radio_metros    INTEGER,
  bbox_norte      DECIMAL(10, 8),
  bbox_sur        DECIMAL(10, 8),
  bbox_este       DECIMAL(11, 8),
  bbox_oeste      DECIMAL(11, 8),

  -- Score de zona (recalculable)
  score_zona              DECIMAL(5, 2) DEFAULT 0,
  peso_segmentos          DECIMAL(5, 2) DEFAULT 0,
  riesgo_comportamiento   DECIMAL(5, 2) DEFAULT 0,
  densidad                DECIMAL(10, 4) DEFAULT 0,  -- cuentas/km²
  compactacion            DECIMAL(3, 2) DEFAULT 0,   -- 0=dispersa, 1=compacta
  distancia_usuario_km    DECIMAL(8, 4) DEFAULT 0,

  -- Resumen crediticio del cluster
  total_cuentas       INTEGER DEFAULT 0,
  cuentas_pendientes  INTEGER DEFAULT 0,
  monto_vencido_total DECIMAL(14, 2) DEFAULT 0,
  tiene_criticas      BOOLEAN DEFAULT FALSE,  -- tiene cuentas 91-120

  -- Estado
  estado  VARCHAR(20) DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente', 'en_progreso', 'completado')),

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: visitas
-- Historial de todas las gestiones realizadas
-- ============================================================
CREATE TABLE IF NOT EXISTS visitas (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  cuenta_id   UUID REFERENCES cuentas_cobranza(id),
  jornada_id  UUID REFERENCES jornadas(id),
  gestor_id   UUID REFERENCES gestores(id),

  resultado   VARCHAR(30) CHECK (resultado IN (
    'contacto_exitoso', 'pago_total', 'pago_parcial',
    'promesa_pago', 'no_localizado', 'rechazo', 'reprogramada'
  )),

  monto_cobrado   DECIMAL(12, 2) DEFAULT 0,
  notas           TEXT,

  -- GPS al momento de la visita
  visita_lat  DECIMAL(10, 8),
  visita_lng  DECIMAL(11, 8),

  -- Contexto de decisión del motor
  fue_de_paso             BOOLEAN DEFAULT FALSE,
  score_cuenta_al_visitar DECIMAL(5, 2),
  motivo_inclusion        TEXT,  -- trazabilidad de por qué se incluyó en la ruta

  visitada_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: geocoding_cache
-- Evita rellamar a la API de Google para direcciones ya procesadas
-- ============================================================
CREATE TABLE IF NOT EXISTS geocoding_cache (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  direccion_canonica  TEXT UNIQUE NOT NULL,
  lat                 DECIMAL(10, 8) NOT NULL,
  lng                 DECIMAL(11, 8) NOT NULL,
  precision_nivel     SMALLINT,
  geocoding_score     DECIMAL(3, 2),
  fuente              VARCHAR(50),
  respuesta_raw       JSONB,
  hits                INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cuentas_jornada    ON cuentas_cobranza(jornada_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_estado     ON cuentas_cobranza(estado_visita);
CREATE INDEX IF NOT EXISTS idx_cuentas_segmento   ON cuentas_cobranza(segmento);
CREATE INDEX IF NOT EXISTS idx_cuentas_cluster    ON cuentas_cobranza(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_score      ON cuentas_cobranza(score_cuenta DESC);
CREATE INDEX IF NOT EXISTS idx_cuentas_geo        ON cuentas_cobranza(lat, lng) WHERE lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clusters_jornada   ON clusters_zona(jornada_id);
CREATE INDEX IF NOT EXISTS idx_visitas_cuenta     ON visitas(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_visitas_jornada    ON visitas(jornada_id);
CREATE INDEX IF NOT EXISTS idx_geocache_canon     ON geocoding_cache(direccion_canonica);

-- ============================================================
-- FUNCIÓN: calcular_segmento
-- Convierte días de mora al segmento oficial
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_segmento(dias INTEGER)
RETURNS VARCHAR AS $$
BEGIN
  IF    dias = 0               THEN RETURN '0';
  ELSIF dias BETWEEN 1   AND 7   THEN RETURN '1-7';
  ELSIF dias BETWEEN 8   AND 15  THEN RETURN '8-15';
  ELSIF dias BETWEEN 16  AND 30  THEN RETURN '16-30';
  ELSIF dias BETWEEN 31  AND 60  THEN RETURN '31-60';
  ELSIF dias BETWEEN 61  AND 90  THEN RETURN '61-90';
  ELSE                              RETURN '91-120';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- FUNCIÓN: calcular_score_urgencia
-- Score estático crediticio (sin componente geográfico)
-- Segmentos 1-7, 8-15, 16-30: el comportamiento pesa más que el segmento
-- Segmentos 31-60, 61-90, 91-120: el segmento pesa más
-- ============================================================
CREATE OR REPLACE FUNCTION calcular_score_urgencia(
  p_segmento        VARCHAR,
  p_comportamiento  VARCHAR,
  p_monto_vencido   DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  v_peso_seg    DECIMAL;
  v_peso_comp   DECIMAL;
  v_peso_monto  DECIMAL;
  v_w_seg       DECIMAL;
  v_w_comp      DECIMAL;
  v_w_monto     DECIMAL;
BEGIN
  -- Peso por segmento de mora
  v_peso_seg := CASE p_segmento
    WHEN '91-120' THEN 40
    WHEN '61-90'  THEN 33
    WHEN '31-60'  THEN 24
    WHEN '16-30'  THEN 15
    WHEN '8-15'   THEN 9
    WHEN '1-7'    THEN 4
    WHEN '0'      THEN 1
    ELSE 1
  END;

  -- Peso por comportamiento histórico
  v_peso_comp := CASE p_comportamiento
    WHEN 'malo'    THEN 25
    WHEN 'regular' THEN 15
    WHEN 'bueno'   THEN 7
    ELSE 15
  END;

  -- Peso por monto (normalizado vs referencia de 50k)
  v_peso_monto := LEAST(15, (COALESCE(p_monto_vencido, 0) / 50000.0) * 15);

  -- Ajustar ponderación según segmento
  -- En segmentos tempranos: comportamiento es criterio principal
  IF p_segmento IN ('1-7', '8-15', '16-30') THEN
    v_w_seg   := 0.25;
    v_w_comp  := 0.60;
    v_w_monto := 0.15;
  ELSE
    v_w_seg   := 0.50;
    v_w_comp  := 0.30;
    v_w_monto := 0.20;
  END IF;

  RETURN LEAST(100, ROUND(
    (v_peso_seg * v_w_seg + v_peso_comp * v_w_comp + v_peso_monto * v_w_monto) * 100 / 100.0,
  2));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- TRIGGER: auto-calcular segmento y score al insertar/actualizar
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_auto_calcular()
RETURNS TRIGGER AS $$
BEGIN
  NEW.segmento      := calcular_segmento(COALESCE(NEW.dias_mora, 0));
  NEW.score_urgencia := calcular_score_urgencia(
    NEW.segmento,
    COALESCE(NEW.comportamiento_historico, 'regular'),
    COALESCE(NEW.monto_vencido, 0)
  );
  -- Score inicial = urgencia (el componente geo se suma en el motor JS)
  IF NEW.score_cuenta = 0 THEN
    NEW.score_cuenta := NEW.score_urgencia;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_calcular_cuenta
BEFORE INSERT OR UPDATE ON cuentas_cobranza
FOR EACH ROW EXECUTE FUNCTION trigger_auto_calcular();

-- ============================================================
-- TRIGGER: actualizar métricas de jornada al registrar visita
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_actualizar_jornada()
RETURNS TRIGGER AS $$
DECLARE
  v_jornada_id UUID;
BEGIN
  -- Obtener jornada_id de la cuenta
  SELECT jornada_id INTO v_jornada_id
  FROM cuentas_cobranza WHERE id = NEW.cuenta_id;

  IF v_jornada_id IS NOT NULL THEN
    UPDATE jornadas SET
      cuentas_visitadas = (
        SELECT COUNT(*) FROM cuentas_cobranza
        WHERE jornada_id = v_jornada_id AND estado_visita = 'visitada'
      ),
      cuentas_no_localizadas = (
        SELECT COUNT(*) FROM cuentas_cobranza
        WHERE jornada_id = v_jornada_id AND estado_visita = 'no_localizada'
      ),
      cuentas_reprogramadas = (
        SELECT COUNT(*) FROM cuentas_cobranza
        WHERE jornada_id = v_jornada_id AND estado_visita = 'reprogramada'
      )
    WHERE id = v_jornada_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actualizar_metricas_jornada
AFTER INSERT ON visitas
FOR EACH ROW EXECUTE FUNCTION trigger_actualizar_jornada();
