'use strict'

/**
 * SERVIDOR PRINCIPAL — ESPARTANOS COBRANZA
 * Stack: Fastify + Supabase
 */

const Fastify = require('fastify')

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

// ── Plugins ──
app.register(require('@fastify/cors'), {
  origin: process.env.CORS_ORIGIN || true,
})

// ── Rutas ──
app.register(require('./src/routes/jornadas'), { prefix: '/api/jornadas' })
app.register(require('./src/routes/cuentas'),  { prefix: '/api/cuentas'  })

// ── Health check ──
app.get('/', async () => ({
  sistema:  'Espartanos Cobranza — Motor de Ruteo Inteligente',
  version:  '1.0.0',
  estado:   'activo',
  timestamp: new Date().toISOString(),
}))

app.get('/health', async () => ({ ok: true }))

// ── Arranque ──
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10)
    await app.listen({ port, host: '0.0.0.0' })
    app.log.info(`Motor de ruteo activo en puerto ${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
