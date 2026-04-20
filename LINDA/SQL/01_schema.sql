-- ================================================================
-- L.I.N.D.A. — Schema Supabase
-- Ejecutar en: Supabase → SQL Editor
-- Requiere: tablas cuentas_cobranza, gestiones, promesas_pago
-- ================================================================

-- ── Tabla de logs del sistema ───────────────────────────────────
CREATE TABLE IF NOT EXISTS linda_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow    TEXT        NOT NULL,
  evento      TEXT        NOT NULL,
  cuenta_id   UUID        REFERENCES cuentas_cobranza(id) ON DELETE SET NULL,
  payload     JSONB,
  error       TEXT,
  duracion_ms INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linda_logs_workflow ON linda_logs(workflow);
CREATE INDEX IF NOT EXISTS idx_linda_logs_fecha    ON linda_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gestiones_canal     ON gestiones(canal, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gestiones_cuenta    ON gestiones(cuenta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promesas_vencidas   ON promesas_pago(fecha_promesa) WHERE cumplida = false;
CREATE INDEX IF NOT EXISTS idx_cuentas_campana     ON cuentas_cobranza(bucket, dias_mora)
  WHERE estado_visita NOT IN ('pagada', 'cancelada');

-- ── Vista: cuentas elegibles para campaña proactiva ─────────────
CREATE OR REPLACE VIEW v_campana_activa AS
SELECT
  c.id,
  c.folio,
  c.nombre_cliente,
  c.telefono,
  c.dias_mora,
  c.bucket,
  c.monto_vencido,
  c.pago_vencido,
  c.saldo_total,
  c.comportamiento_historico,
  COALESCE(
    (SELECT MAX(g.created_at)
     FROM gestiones g
     WHERE g.cuenta_id = c.id AND g.canal = 'whatsapp'),
    '2000-01-01'::TIMESTAMPTZ
  ) AS ultima_wa,
  (
    SELECT COUNT(*)
    FROM promesas_pago p
    WHERE p.cuenta_id = c.id AND p.cumplida = false
  ) AS promesas_pendientes
FROM cuentas_cobranza c
WHERE c.estado_visita NOT IN ('pagada', 'cancelada')
  AND c.bucket IN ('1-30', '31-60', '61-90')
  AND c.telefono IS NOT NULL
  AND c.dias_mora > 0;

-- ── Vista: promesas vencidas para reactivar ──────────────────────
CREATE OR REPLACE VIEW v_promesas_vencidas AS
SELECT
  p.id          AS promesa_id,
  p.cuenta_id,
  p.monto_prometido,
  p.fecha_promesa,
  c.nombre_cliente,
  c.telefono,
  c.bucket,
  c.dias_mora,
  c.monto_vencido,
  c.saldo_total,
  c.comportamiento_historico
FROM promesas_pago p
JOIN cuentas_cobranza c ON c.id = p.cuenta_id
WHERE p.cumplida = false
  AND p.fecha_promesa < CURRENT_DATE
  AND c.estado_visita NOT IN ('pagada', 'cancelada');

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE linda_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "linda_logs_service_all"
  ON linda_logs FOR ALL TO service_role USING (true);
