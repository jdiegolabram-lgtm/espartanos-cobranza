-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 003: tablas de L.I.N.D.A.
-- conversaciones, promesas, seguimientos + columnas extra en cuentas_cobranza
-- ─────────────────────────────────────────────────────────────────────────────

-- Columna telefonos (todos los teléfonos del lead, CSV)
ALTER TABLE cuentas_cobranza
  ADD COLUMN IF NOT EXISTS telefonos TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Historial de conversaciones WhatsApp con L.I.N.D.A.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversaciones (
  id              BIGSERIAL PRIMARY KEY,
  telefono        TEXT,
  plan            TEXT,
  mensaje_cliente TEXT NOT NULL,
  respuesta_linda TEXT,
  intent          TEXT,
  management_result TEXT,
  should_escalate BOOLEAN DEFAULT FALSE,
  raw_response    JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_plan      ON conversaciones (plan);
CREATE INDEX IF NOT EXISTS idx_conv_telefono  ON conversaciones (telefono);
CREATE INDEX IF NOT EXISTS idx_conv_created   ON conversaciones (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Promesas de pago capturadas por L.I.N.D.A. o por gestor
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promesas (
  id               BIGSERIAL PRIMARY KEY,
  plan             TEXT NOT NULL,
  telefono         TEXT,
  canal            TEXT DEFAULT 'whatsapp',
  monto            NUMERIC(12,2),
  fecha_compromiso DATE,
  estatus          TEXT DEFAULT 'pendiente'
                     CHECK (estatus IN ('pendiente','cumplida','incumplida')),
  nota             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promesas_plan    ON promesas (plan);
CREATE INDEX IF NOT EXISTS idx_promesas_estatus ON promesas (estatus);
CREATE INDEX IF NOT EXISTS idx_promesas_fecha   ON promesas (fecha_compromiso);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seguimientos programados (por L.I.N.D.A. o por gestor)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seguimientos (
  id               BIGSERIAL PRIMARY KEY,
  plan             TEXT NOT NULL,
  telefono         TEXT,
  canal            TEXT DEFAULT 'whatsapp',
  fecha_programada DATE NOT NULL,
  motivo           TEXT,
  estatus          TEXT DEFAULT 'pendiente'
                     CHECK (estatus IN ('pendiente','ejecutado','cancelado')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seg_plan   ON seguimientos (plan);
CREATE INDEX IF NOT EXISTS idx_seg_fecha  ON seguimientos (fecha_programada);
CREATE INDEX IF NOT EXISTS idx_seg_status ON seguimientos (estatus);
