# Variables de Entorno — L.I.N.D.A.

## n8n Cloud (Settings → Variables)

| Variable | Descripción | Dónde obtener |
|----------|-------------|---------------|
| `SUPABASE_URL` | URL del proyecto Supabase | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Service Role Key (secreta) | Supabase → Settings → API |
| `GEMINI_API_KEY` | API Key de Google Gemini | aistudio.google.com |
| `WHATSAPP_TOKEN` | Token permanente de Meta | Meta for Developers → App → WhatsApp |
| `WHATSAPP_PHONE_ID` | Phone Number ID | Meta → WhatsApp → API Setup |

## Railway (ya configuradas)

| Variable | Valor |
|----------|-------|
| `WHATSAPP_VERIFY_TOKEN` | espartanos_secret_2026 |
| `WHATSAPP_TOKEN` | EAA... (mismo que n8n) |
| `WHATSAPP_PHONE_NUMBER_ID` | 1111516238701437 |
| `N8N_WEBHOOK_URL` | https://d1360.app.n8n.cloud/webhook/ai-cobranza |
| `SUPABASE_URL` | https://xxxx.supabase.co |
| `SUPABASE_SERVICE_KEY` | eyJ... |

## Cómo crear Variables en n8n Cloud

1. n8n → **Settings** (engrane inferior izquierdo)
2. **Variables** → **+ Add Variable**
3. Agregar cada variable de la tabla de arriba
4. Las variables se referencian en workflows como `{{ $vars.NOMBRE }}`
