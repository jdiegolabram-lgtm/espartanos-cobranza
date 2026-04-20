# L.I.N.D.A. — Sistema Inteligente de Cobranza

**Lógica Inteligente de Negociación y Diálogo Automatizado**

## Arquitectura

```
Meta WhatsApp
    ↓  (mensaje entrante)
Railway POST /webhook/whatsapp
    ↓  (payload normalizado)
n8n W1-Reactivo  ←────────────────── cliente escribe
n8n W2-Proactivo ←────────────────── schedule 9am L-S
n8n W3-Promesas  ←────────────────── schedule 8am diario
    ↓
Gemini 1.5 Flash (genera mensaje según modelo)
    ↓
WhatsApp Cloud API (envía)
    ↓
Supabase (registra gestión + log)
```

## Modelos de Negociación

| Bucket | Comportamiento | Modelo |
|--------|---------------|--------|
| 1-30   | cualquiera    | Empático |
| 31-60  | normal/bueno  | Firme |
| 31-60  | malo          | Presión |
| 61-90  | cualquiera    | Presión |

## Variables n8n (Settings → Variables)

```
SUPABASE_URL          https://xxxx.supabase.co
SUPABASE_SERVICE_KEY  eyJ...
GEMINI_API_KEY        AIza...
WHATSAPP_TOKEN        EAA...
WHATSAPP_PHONE_ID     1111516238701437
```

## Importar Workflows

1. n8n → **Workflows** → botón `+` → **Import from file**
2. Importar en orden: W1 → W2 → W3 → W4
3. Configurar variables en **Settings → Variables**
4. Activar W1 primero, probar con mensaje real
5. Activar W2 y W3 solo cuando W1 funcione

## Estructura

```
/LINDA
  /SQL        → ejecutar en Supabase SQL Editor
  /N8N        → importar en n8n Cloud
  /PROMPTS    → referencia de prompts IA
  /DOCS       → variables y configuración
```
