# Espartanos Cobranza — Motor de Ruteo Inteligente

Plataforma SaaS de cobranza en campo con motor de ruteo territorial premium.

## Stack

- **Backend:** Node.js + Fastify
- **Base de datos:** Supabase (PostgreSQL)
- **Geocodificación:** Google Maps Geocoding API
- **Deploy:** Railway

## Estructura del proyecto

```
espartanos-cobranza/
├── server.js                          # Punto de entrada Fastify
├── supabase/
│   └── migrations/
│       └── 001_schema_inicial.sql     # Schema completo de la BD
└── src/
    ├── config/
    │   └── supabase.js                # Cliente de Supabase
    ├── modules/
    │   ├── normalizacion/index.js     # Limpieza y homologación de direcciones
    │   ├── geocodificacion/index.js   # Geocodificación en cascada con caché
    │   └── scoring/index.js           # Score de cuenta y score de zona
    └── routes/
        ├── jornadas.js                # CRUD de jornadas de trabajo
        └── cuentas.js                 # Ingesta, visitas y consulta de cuentas
```

## Setup

```bash
# 1. Clonar e instalar
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# 3. Ejecutar migration en Supabase
# Ir a Supabase → SQL Editor → pegar contenido de supabase/migrations/001_schema_inicial.sql

# 4. Arrancar servidor
npm run dev
```

## Variables de entorno requeridas

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | Service Role Key (solo backend) |
| `GOOGLE_MAPS_API_KEY` | API Key con Geocoding API habilitada |

## API Endpoints

### Jornadas
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/jornadas` | Crear nueva jornada |
| GET | `/api/jornadas/:id` | Estado de una jornada |
| PATCH | `/api/jornadas/:id/posicion` | Actualizar GPS del gestor |
| PATCH | `/api/jornadas/:id/cerrar` | Cerrar jornada |

### Cuentas
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/cuentas/ingestar` | Ingestar lote de cuentas crudas |
| GET | `/api/cuentas/pendientes/:jornada_id` | Cuentas pendientes ordenadas por score |
| PATCH | `/api/cuentas/:id/visita` | Registrar resultado de visita |
| GET | `/api/cuentas/:id` | Detalle de cuenta con historial |
