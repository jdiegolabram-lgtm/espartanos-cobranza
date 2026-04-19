'use strict'

/**
 * SERVIDOR PRINCIPAL — ESPARTANOS COBRANZA
 * Stack: Fastify + Supabase
 * v2.0: incluye Agente L.I.N.D.A.
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

// ── Rutas existentes ──
app.register(require('./src/routes/jornadas'), { prefix: '/api/jornadas' })
app.register(require('./src/routes/cuentas'),  { prefix: '/api/cuentas'  })

// ── Rutas L.I.N.D.A. ──
app.register(require('./src/routes/agent'),        { prefix: '/agent'            })
app.register(require('./src/routes/gestion'),      { prefix: '/api/gestion'      })
app.register(require('./src/routes/promesas'),     { prefix: '/api/promesa'      })
app.register(require('./src/routes/seguimientos'), { prefix: '/api/seguimientos' })
app.register(require('./src/routes/email'),        { prefix: '/api/email'        })

// ── WhatsApp webhook (Meta) ──
app.register(require('./src/routes/whatsapp'), { prefix: '/webhook/whatsapp' })

// ── Health check ──
app.get('/', async () => ({
  sistema:   'Espartanos Cobranza — Motor de Ruteo + L.I.N.D.A.',
  version:   '2.0.0',
  estado:    'activo',
  timestamp: new Date().toISOString(),
}))

app.get('/health', async () => ({ ok: true }))

// ── Arranque ──
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10)
    await app.listen({ port, host: '0.0.0.0' })
    app.log.info(`Servidor activo en puerto ${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
