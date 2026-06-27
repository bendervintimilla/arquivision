# ArquiVision AI

**Generative-AI rendering studio for architects and interior designers.**
Upload a photo of a real space (or a floor plan) and get a photorealistic,
edit-by-instruction redesign in seconds — in the client's chosen style,
controlled in plain Spanish or English.

> Final project — *Generative AI*, MCSBT, IE University.
> Team: Vintimilla · Ortega · Seben.
> **Live demo: https://bednrixvision.ai** · Repo: `github.com/bendervintimilla/bender-archivisionAI`

---

## 1. The business problem

In an architecture or interior-design studio, turning a client conversation
into a believable visual is slow and expensive. A single photorealistic render
of one room, in one style, typically costs **€150–€600** and takes **2–5 days**
through a 3D artist (modeling, materials, lighting, render farm). That latency
kills the sales conversation: the client wants to *see* "the same living room
but Scandinavian, with the sofa facing the window" **while they are still in the
meeting**, not next week.

ArquiVision collapses that loop from days to seconds. The designer uploads the
client's actual photo, types the change in natural language, and gets a
photoreal variation immediately — iterating live with the client until they say
*"that one."*

**Value proposition:** replace a €150–€600, multi-day render task with a
sub-30-second, sub-$0.30 generation, so a studio can close design decisions in
the first meeting instead of losing momentum between sessions.

---

## 2. What it does

ArquiVision is a single-page app with four workspaces:

| Module | What it does |
|---|---|
| **Photo Enhancer** | Upload a room photo → instruct edits in natural language ("dale estilo industrial", "molduras que rodeen la TV", "cambia el suelo a roble en espiga"). Style presets, masking for surgical edits, reference-image style transfer, multi-view input, and an A/B lab that runs the same prompt through GPT‑Image‑2 and Gemini side by side. |
| **Plan → Render** | Upload a floor plan (PNG or DXF) → render it as a furnished photoreal interior with geometry conditioning, or modify the plan itself with vector operations (add/move walls, doors, windows). |
| **Video Studio** | Turn any render into a cinematic architectural fly-through (Veo 3.1), with the scene's geometry and lighting preserved. |
| **Admin Dashboard** | Live usage, latency and **cost** telemetry per model and per day (owner-only). |

### The "moat" (why this isn't just an API wrapper)

The model is swappable; the intelligence around it is the product:

- **Spanish architectural vocabulary engine.** A dedicated intent classifier
  understands real studio language — *cornisa, moldura, cuarterón, zócalo,
  encimera, faja perimetral, rodear/enmarcar* — and translates it into precise
  generation prompts. This is the differentiator against generic "redesign my
  room" tools.
- **3-call edit pipeline.** Every edit runs (1) intent classification, (2) scene
  analysis (cached), then (3) generation — so the model is told *what* to change,
  *what to preserve*, and the *exact camera/lighting* of the original.
- **Quality tiers (Draft / Standard / HD / Ultra)** map transparently to a model,
  resolution and batch size, with a silent provider fallback chain.
- **Cumulative edit lineage** keeps a chain of edits consistent with the original
  upload instead of drifting.
- **Cost guardrails**: per-user daily spend cap + full usage logging to Supabase.

---

## 3. Architecture

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│  Frontend (React 19 + Vite)  │        │  Backend (Flask proxy)        │
│  ──────────────────────────  │  HTTPS │  ───────────────────────────  │
│  • PhotoEnhancer  • Plan→Rndr │ ─────► │  /api/classify-intent         │
│  • VideoStudio    • Admin     │  JWT   │  /api/analyze-scene           │
│  • Supabase Auth (Google/email)│       │  /api/generate-image (tiered) │
│  • Gallery + conversations    │ ◄───── │  /api/plan-to-render          │
└───────────────┬──────────────┘        │  /api/generate-video (Veo)    │
                │                        │  /api/enhance-image           │
                │                        │  /api/ab-compare              │
                ▼                        │  /api/admin/usage             │
        ┌───────────────┐               └───────┬───────────────┬───────┘
        │   Supabase    │                       │               │
        │ Auth · Postgres│◄──────────────────────┘               ▼
        │ Storage · RLS  │   usage_logs / creative_datasets   ┌─────────────┐
        └───────────────┘                                     │ Model layer │
                                                              │ OpenAI gpt- │
                                                              │ image-2 +   │
                                                              │ Gemini 2.5/ │
                                                              │ 3 + Veo 3.1 │
                                                              └─────────────┘
```

**Why a backend proxy instead of calling the model from the browser:** it keeps
the API keys server-side, validates the Supabase JWT on every call (RLS-gated
inserts run as the user), enforces the spend cap, and centralizes model routing
so swapping providers is a one-file change.

### Tech stack

- **Frontend:** React 19, TypeScript, Vite 6, Supabase JS, `dxf-parser`.
- **Backend:** Python / Flask, `google-genai`, `openai`, `ezdxf`, Pillow.
- **Data & auth:** Supabase (Postgres + Auth + Storage + Row-Level Security).
- **Models:** OpenAI `gpt-image-2` (Standard/HD/Ultra), Gemini `2.5-flash-image`
  (Draft + fallback), Gemini `2.5-flash` (text/vision analysis), Veo `3.1` (video).

---

## 4. Running it locally

### Prerequisites
- Node.js ≥ 20 and npm
- Python ≥ 3.11
- A Supabase project (free tier is enough)
- A Google Gemini API key (required) and, optionally, an OpenAI key with
  `gpt-image-2` access (for the Standard/HD/Ultra tiers)

### 4.1 Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # then fill in the values
python main.py              # serves on http://localhost:5000
```

Fill `backend/.env`:

```bash
GEMINI_API_KEY=...                 # required
SUPABASE_URL=https://<proj>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...           # optional, for system-level logging
OPENAI_API_KEY=sk-...              # optional, enables gpt-image-2 tiers
OPENAI_IMAGE_MODEL=gpt-image-2
# SKIP_AUTH=true                   # local dev only — bypasses JWT for quick testing
```

> Quick local demo without Supabase login? Set `SKIP_AUTH=true` in `backend/.env`.

### 4.2 Frontend

```bash
# from the repo root
npm install
cp .env.example .env.local         # then fill in the values
npm run dev                        # serves on http://localhost:5173
```

Fill `.env.local`:

```bash
VITE_SUPABASE_URL=https://<proj>.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_BACKEND_URL=http://localhost:5000
```

### 4.3 Database

Apply the migrations in `supabase/migrations/` (via the Supabase SQL editor or
the Supabase CLI) to create the `usage_logs` and `creative_datasets` tables and
their RLS policies.

### 4.4 Verify

Open `http://localhost:5173`, sign in, drop a room photo into **Photo Enhancer**,
pick a style preset, and generate. Backend health is at
`http://localhost:5000/api/health`.

---

## 5. Project structure

```
ARQUIVISION-AI-ACTIVE/
├── App.tsx, index.tsx, index.html     # React entry
├── pages/                             # PhotoEnhancer, PlanToRender, VideoStudio, AdminDashboard
├── components/                        # Header, ImageUploader, MaskEditor, Auth, ...
├── services/                          # geminiService, backendApiService, cad/autocad, supabase, ...
├── contexts/ · hooks/                 # Auth context, conversation hook
├── constants.ts, types.ts             # design presets + shared types
├── backend/
│   ├── main.py                        # Flask proxy: all /api endpoints
│   ├── models_config.py               # single source of truth: models, tiers, pricing
│   ├── openai_client.py               # gpt-image-2 generate/edit
│   └── requirements.txt
├── supabase/migrations/               # schema + RLS
└── .agents/arquivision_improvement_plan.md   # technical roadmap (v3)
```

---

## 6. Roadmap

The detailed engineering roadmap lives in
[`.agents/arquivision_improvement_plan.md`](.agents/arquivision_improvement_plan.md).
Shipped: OpenAI `gpt-image-2` swap, cumulative edit lineage, multi-view input,
Plan→Render conditioning, A/B lab. Next: Flux + ControlNet for locked plan
geometry, a real upscaler for "Enhance HD", and a video quality tier.

---

## 7. Team

**Vintimilla · Ortega · Seben** — MCSBT, IE University, *Generative AI* (Prof. Concepción Díaz Cantero).
