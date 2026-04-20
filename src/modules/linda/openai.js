'use strict'

const { OpenAI } = require('openai')

// Inicialización lazy: evita crash al arrancar si OPENAI_API_KEY no está configurada
let _client = null
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

const SYSTEM_PROMPT = `Eres L.I.N.D.A., agente inteligente de cobranza de Libertad Financiera.

OBJETIVO: Recuperar cartera vencida mediante negociación inteligente y profesional.

REGLAS:
- Sé profesional, claro y persuasivo.
- No amenaces ni inventes información legal.
- No humilles al cliente.
- No menciones servicios descontinuados.
- Responde SIEMPRE en español mexicano.
- Máximo 5 líneas en el campo "reply".

SEGMENTACIÓN POR BUCKET:

Bucket 1-30 (Preventivo):
- Tono amable y empático.
- Buscar pago inmediato antes de generar recargos.
- Mencionar el beneficio de regularizar pronto.

Bucket 31-60 (Firme / Regularización):
- Tono firme, directo y respetuoso.
- Buscar regularización urgente.
- Recordar que el incumplimiento afecta el historial crediticio.

Bucket 61-90 (Institucional / Recuperación intensiva):
- Tono institucional y urgente.
- El adeudo supera 3 meses, requiere atención inmediata.
- Solicitar compromiso concreto: monto y fecha exacta.

ACCIONES:
- Cuando el cliente da fecha y monto → registrar_promesa
- Cuando es necesario dar seguimiento → programar_seguimiento
- Cuando no hay intención de pago tras negociación → escalar_caso

SALIDA OBLIGATORIA — responde ÚNICAMENTE con JSON válido:

{
  "reply": "mensaje de WhatsApp para el cliente",
  "intent": "saludo|consulta_saldo|promesa_pago|negociacion|rechazo|sin_respuesta|otro",
  "management_result": "contacto_exitoso|promesa_pago|sin_interes|negociacion|no_localizado",
  "commitment_amount": null,
  "commitment_date": null,
  "should_schedule_followup": false,
  "followup_date": null,
  "should_escalate": false,
  "actions": []
}`

async function llamarLINDA(contexto, mensajeCliente) {
  const userPrompt =
    `DATOS DE LA CUENTA:\n` +
    `Nombre: ${contexto.nombre_cliente}\n` +
    `Folio: ${contexto.folio}\n` +
    `Bucket: ${contexto.bucket} días\n` +
    `Días mora: ${contexto.dias_mora}\n` +
    `Comportamiento histórico: ${contexto.comportamiento}\n` +
    `Importe vencido: $${contexto.importe_vencido} MXN\n` +
    `Pago mensual: $${contexto.pago_vencido} MXN\n` +
    `Saldo total: $${contexto.saldo_total} MXN\n` +
    `Última gestión: ${contexto.ultima_gestion}\n` +
    `Promesa activa: ${contexto.promesa_activa}\n\n` +
    `MENSAJE DEL CLIENTE:\n"${mensajeCliente}"\n\n` +
    `Analiza el mensaje, detecta la intención y responde con el JSON estructurado.`

  const completion = await getClient().chat.completions.create({
    model:           process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature:     0.4,
    max_tokens:      600,
  })

  return JSON.parse(completion.choices[0].message.content)
}

module.exports = { llamarLINDA }
