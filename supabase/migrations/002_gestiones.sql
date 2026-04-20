-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 002: tabla gestiones
-- Registra cada intento de contacto (WA, SMS, correo) por lead
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gestiones (
  id         BIGSERIAL PRIMARY KEY,
  plan       TEXT        NOT NULL,            -- folio/plan del lead
  canal      TEXT        NOT NULL CHECK (canal IN ('wa','sms','mail','visita')),
  estatus    TEXT        NOT NULL CHECK (estatus IN ('enviado','error','omitido')),
  nota       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frecuentes por lead y por fecha
CREATE INDEX IF NOT EXISTS idx_gestiones_plan       ON gestiones (plan);
CREATE INDEX IF NOT EXISTS idx_gestiones_created_at ON gestiones (created_at DESC);

-- También agrega la columna `seg` a cuentas_cobranza si no existe
-- (el parseo de Excel la llena; las columnas nuevas no rompen los registros viejos)
ALTER TABLE cuentas_cobranza
  ADD COLUMN IF NOT EXISTS seg             TEXT,
  ADD COLUMN IF NOT EXISTS plan            TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS clabe           TEXT,
  ADD COLUMN IF NOT EXISTS empresa         TEXT,
  ADD COLUMN IF NOT EXISTS comportamiento  TEXT DEFAULT 'Regular',
  ADD COLUMN IF NOT EXISTS regularizada    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS colonia         TEXT,
  ADD COLUMN IF NOT EXISTS calle           TEXT,
  ADD COLUMN IF NOT EXISTS noCuotas        INT  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cuotas          NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total           NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo           NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dm              INT  DEFAULT 0;
