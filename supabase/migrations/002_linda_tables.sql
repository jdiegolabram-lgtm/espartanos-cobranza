-- ================================================================
-- MIGRACIÓN 002: Tablas L.I.N.D.A.
-- Agente Inteligente de Cobranza — Espartanos QRO
-- ================================================================

-- ── Gestiones ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gestiones (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cuenta_id    UUID        REFERENCES cuentas_cobranza(id) ON DELETE CASCADE,
  canal        TEXT        NOT NULL DEFAULT 'whatsapp', -- whatsapp | sms | email | telefonica | presencial
  tipo         TEXT        NOT NULL DEFAULT 'T',        -- T | P | N/A
  mensaje_in   TEXT,
  mensaje_out  TEXT,
  intent       TEXT,
  resultado    TEXT,        -- contacto_exitoso | promesa_pago | sin_interes | negociacion | no_localizado
  agente       TEXT        DEFAULT 'LINDA',
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gestiones_cuenta_id  ON gestiones(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_gestiones_created_at ON gestiones(created_at DESC);

-- ── Promesas de pago ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promesas_pago (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cuenta_id        UUID        REFERENCES cuentas_cobranza(id) ON DELETE CASCADE,
  monto_prometido  NUMERIC(12,2) NOT NULL,
  fecha_promesa    DATE          NOT NULL,
  cumplida         BOOLEAN       DEFAULT false,
  canal            TEXT          DEFAULT 'whatsapp',
  notas            TEXT,
  created_at       TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promesas_cuenta_id    ON promesas_pago(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_promesas_fecha        ON promesas_pago(fecha_promesa);
CREATE INDEX IF NOT EXISTS idx_promesas_no_cumplidas ON promesas_pago(cumplida) WHERE cumplida = false;

-- ── Seguimientos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seguimientos (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cuenta_id   UUID        REFERENCES cuentas_cobranza(id) ON DELETE CASCADE,
  fecha_prog  DATE        NOT NULL,
  motivo      TEXT,       -- promesa_incumplida | escalacion | recordatorio | seguimiento_agente
  canal       TEXT        DEFAULT 'whatsapp',
  completado  BOOLEAN     DEFAULT false,
  escalado    BOOLEAN     DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seguimientos_cuenta_id   ON seguimientos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_seguimientos_fecha_prog  ON seguimientos(fecha_prog);
CREATE INDEX IF NOT EXISTS idx_seguimientos_pendientes  ON seguimientos(completado, fecha_prog) WHERE completado = false;

-- ── RLS: todas las tablas accesibles con service_role ────────
ALTER TABLE gestiones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE promesas_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguimientos  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role gestiones"     ON gestiones     USING (true) WITH CHECK (true);
CREATE POLICY "service_role promesas_pago" ON promesas_pago USING (true) WITH CHECK (true);
CREATE POLICY "service_role seguimientos"  ON seguimientos  USING (true) WITH CHECK (true);
