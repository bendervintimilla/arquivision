# ArquiVision AI — Master Improvement Plan v3
**Last updated:** 2026-05-19
**Owner:** Juan (juanchovintimilla91@gmail.com)
**Strategic decision (this version):** Replace Gemini 3 Pro Image with **GPT Image 2** as the primary render model. Keep Gemini Flash for drafts and Gemini Pro as silent fallback. Only PlanToRender adds Flux + ControlNet later (Phase 3).

---

## TL;DR — The bet, in one paragraph

The reason ChatGPT is winning is not architecture intelligence or prompt scaffolding — those are ours and we keep them. It is the underlying model. **GPT Image 2** (`gpt-image-2`, OpenAI, April 21 2026) holds a +242 Elo lead in the public image arena, generates 8 images per request with cross-image continuity, and runs an internal reasoning loop that plans/critiques/retries before returning. Gemini 3 Pro Image, our current default, sits noticeably below it on instruction-following and detail.

We are going to **drop GPT Image 2 in as the model behind Tiers 1, 2 and 3** of the existing quality selector. Gemini Flash Image stays as Tier 0 (drafts are cheap iteration, GPT is overkill). Gemini Pro Image stays in the codebase as the silent fallback when GPT is rate-limited or down. Everything we built around the model — the intent classifier with Spanish architectural vocabulary, the scene analysis cache, the framing detection, the mask flow, the watermarks — survives unchanged. We are swapping the engine, not rebuilding the car.

A handful of things this swap *does not* fix and that we need anyway: Plan→Render still needs ControlNet (only Flux has it); "Enhance HD" still needs to be a real upscaler (Krea/Magnific); video still has its own roadmap (Veo 3.1 + optionally Runway for motion-brush). Those phases are unchanged from v2.

---

## 1. Why GPT Image 2 (and not "all of them")

The earlier plan (v2) argued for a multi-vendor router (Gemini + GPT + Flux all behind one abstraction). That added 3 weeks of plumbing that wasn't going to ship customer value any faster than a direct swap. We're cutting it.

| Question | Honest answer |
|---|---|
| Is GPT Image 2 measurably better than Gemini 3 Pro Image for our main use case (edit/style/text-to-image)? | Yes. +242 Elo, 8-image batches, reasoning loop, near-perfect text rendering. |
| Will the customer who said "ChatGPT está ganando" notice the difference? | Yes — they were comparing against ChatGPT, which uses this exact model. We close the gap by definition. |
| What do we lose by going single-vendor again? | Same risk we have today with Gemini — vendor lock-in, rate-limit exposure. Mitigated by keeping Gemini Pro as fallback, not eliminated. |
| Do we lose anything Flux Kontext gave us? | For edits, marginal. GPT Image 2's edit endpoint with mask + reference is competitive with Flux Kontext Max for our types of edits. For *plan→render with geometry preservation* we still need Flux + ControlNet — that's Phase 3 and unchanged. |
| Cost? | ~3× Gemini Pro per HD render. We must ship the per-user daily $ cap in Phase 1 — non-negotiable. |
| Latency? | ~15–25s per render (vs ~6s on Gemini). The reasoning loop is the whole point but it costs wall-clock time. Mitigation: keep Draft tier on Gemini Flash (sub-3s) for iteration. |

### 1.1 What GPT Image 2 brings that we cannot replicate in prompt engineering

1. **Internal reasoning loop.** It plans the image, generates candidate, verifies against the prompt, retries if it failed. We had this on the v2 roadmap as a custom critique loop (Phase 2.3). With GPT Image 2 we get it for free — no extra latency on top, because it's inside the model call.
2. **8-image batch with object continuity.** A single API call with `n=8` returns 8 images that share the same characters/objects in different framings. Architects love this for "show me the same room from 4 angles" or "same kitchen with 4 material palettes".
3. **Near-perfect text rendering.** Renders that include readable signage, room labels, dimensions on a plan — GPT Image 2 produces legible text where Gemini produces gibberish.
4. **Web-grounded references.** Optional: the model can pull references from the web to inform the image (e.g., "Make this look like Casa Mila by Gaudí" — it actually knows what Casa Mila looks like). Off by default for us.

### 1.2 What we still need outside of GPT Image 2

- **Tier 0 Draft (cheap iteration):** Gemini 2.5 Flash Image. Stays.
- **Plan→Render with geometric fidelity:** Flux + Depth + Canny ControlNet. Phase 3 only.
- **Real upscaler ("Enhance HD"):** Krea or Magnific. Phase 4 only.
- **Video:** Veo 3.1 stays default; Runway Gen-4.5 optional for motion-brush. Phase 5 only.

### 1.3 Sources

- [ChatGPT Images 2.0 — OpenAI launch post](https://openai.com/index/introducing-chatgpt-images-2-0/)
- [GPT Image 2 developer breakdown (April 2026)](https://www.buildfastwithai.com/blogs/chatgpt-images-2-0-gpt-image-2-2026)
- [Best ChatGPT image model 2026 (CometAPI)](https://www.cometapi.com/best-chatgpt-model-for-image-generation-in-2026/)
- [OpenAI Images 2 capabilities (Neurohive)](https://neurohive.io/en/news/chatgpt-images-2-0-openai-launches-image-generation-model-with-reasoning-2k-resolution-and-multilingual-text/)
- [Flux Depth/Canny ControlNet guide](https://apatero.com/blog/flux-depth-canny-controlnet-complete-guide-2025) — still relevant for Phase 3
- [Krea vs Magnific vs Topaz](https://tasarim.ai/en/compare/krea-ai-vs-magnific-ai-vs-topaz-photo-ai) — Phase 4
- [Veo 3.1 vs Runway Gen-4.5 vs Kling](https://diffstudy.com/runway-gen-4-vs-kling-3-vs-veo-3/) — Phase 5

---

## 2. Inventory of the current pipeline

Folder: `~/Desktop/Escritorio - MacBook Air de Juan/ARQUIVISION-AI-ACTIVE/`
Repo: `bendervintimilla/bender-archivisionAI`

### 2.1 Models wired today (and where they live)

```python
# backend/main.py — TO BE CHANGED in Phase 1
IMAGE_MODEL      = "gemini-3-pro-image-preview"  # tiers 1/2/3   ← will become gpt-image-2
FAST_IMAGE_MODEL = "gemini-2.5-flash-image"      # tier 0 + 503 fallback  ← KEEP
FAST_MODEL       = "gemini-2.5-flash"            # text/vision analysis  ← KEEP (it's text)
VIDEO_MODEL      = "veo-3.1-fast-generate-preview"  # ← KEEP (Phase 5 reconsiders)
```

```typescript
// constants.ts — TO BE CHANGED in Phase 1
export const MODEL_NAME = 'gemini-3-pro-image-preview';           // ← will become 'gpt-image-2'
export const FAST_IMAGE_MODEL_NAME = 'gemini-2.5-flash-image';    // ← KEEP
export const FAST_MODEL_NAME = 'gemini-2.5-flash';                // ← KEEP
```

### 2.2 The 3-call edit pipeline (unchanged — this is our moat)

For every edit, `generateArchitecturalVariations` calls:
1. `POST /api/classify-intent` — Gemini Flash text → `EditIntent` JSON (Spanish vocab, framing detection)
2. `POST /api/analyze-scene` — Gemini Flash vision → `SceneAnalysis` JSON (cached locally)
3. `POST /api/generate-image` — **(today Gemini Pro / Phase 1 GPT Image 2)** → final render

Steps 1 and 2 stay on Gemini Flash for cost reasons — they are cheap text/vision analysis and switching them buys nothing.

### 2.3 What is good about the current pipeline (do not regress)

- **Spanish architectural vocabulary** in `autocadService.ts` (cornisa, moldura, cuarterón, zócalo, faja perimetral, etc.). This is a real moat.
- **PRECISION_EDIT scale detection** for sub-10% changes — well-tuned surgical-edit prompts.
- **Framing detection** ("rodear", "enmarcar") with explicit frame-around-element prompts.
- **Quality tier system (0/1/2/3)** mapping to model + resolution — perfect abstraction for the swap.
- **Reference image + mask flow** is structurally correct.
- **Usage logging to Supabase** — we have telemetry to measure the swap's impact.
- **Watermark applied in canvas after generation** preserves model output integrity.

---

## 3. Issues from plan v1 (Feb–Mar 2026) — current status

### ✅ Fixed since v1

| # | Issue | Fix evidence |
|---|---|---|
| 1 | Conversation context not injected | `formatContextForImagePrompt` + `--- DESIGN SESSION BACKGROUND ---` (`geminiService.ts:308`) |
| 2 | Scene cache hash collisions | `imageHash` samples 3 slices + length (`geminiService.ts:49-56`) |
| 4 | `useFastModel` never used | Replaced by `qualityTier` UI selector (PhotoEnhancer.tsx:382-405) |
| 7 | Reference image prompt too vague | Explicit "IMAGE 1 vs IMAGE 2" structured block (`geminiService.ts:325-327`) |
| 8 | Mask prompt missing | `MASK IMAGE PROVIDED... WHITE = apply, BLACK = preserve` (`geminiService.ts:317-322`) |
| 5 | Speed-mode toggle | 4-tier selector shipped (Draft/Std/HD/Ultra) |

### 🟡 Still open from v1 — carried into this plan

| # | Issue | Where it goes in this plan |
|---|---|---|
| 3 | No iterative context between generations | Phase 2 (cumulative lineage) |
| 6 | No cumulative prompt chain | Phase 2 |
| 9 | Vector operations fragile | Phase 3 (bounds checking part of Plan→Render rework) |
| 10 | Video has no scene-analysis context | Phase 5 |
| 12 | Gallery assets store no scene analysis | Phase 5 (RenderAsset type extension) |
| 11 | No real undo stack | Phase 6 (nice-to-have) |
| 14 | Multi-image batch generation | **Phase 1** — GPT Image 2 makes this free |

---

## 4. Issues found 2026-05-19 — what this plan addresses

### 4.1 🔴 Primary issue: model ceiling

`gemini-3-pro-image-preview` is below `gpt-image-2` on every public benchmark and on subjective architect feedback. Every other improvement is capped by this ceiling.
**Fix:** Phase 1.

### 4.2 🔴 Plan→Render has no structural conditioning

`PlanToRender.tsx:309` asks Gemini politely to "maintain exact room proportions" with no geometric constraint. Gemini frequently hallucinates wall positions. GPT Image 2 will do the same — it has no native ControlNet either. The real fix is **Flux + Depth + Canny ControlNet**, which is the only mature path for plan→render with geometry preservation.
**Fix:** Phase 3.

### 4.3 🔴 "Enhance HD" is a misleading second Gemini pass

`backend/main.py:496-570` sends the image back to Gemini with a verbose "ENHANCE this" prompt. Gemini is not an upscaler. It cannot restore high-frequency detail it never had. Real upscalers (Krea, Magnific, Recraft) outperform this by a wide margin.
**Fix:** Phase 4.

### 4.4 🔴 No self-verification loop

In v2 we proposed a custom critique loop. **Killed:** GPT Image 2 has this internally. Building our own on top of it is redundant and would just stack latency. We drop this work item.

### 4.5 🔴 Output is one image — should be 4–8

GPT Image 2 returns `n=8` natively with cross-image continuity. We currently return 1.
**Fix:** Phase 1.

### 4.6 🟡 Veo 3.1 fast is the default

`veo-3.1-fast-generate-preview` trades motion quality for cost. We need a Standard tier.
**Fix:** Phase 5.

### 4.7 🟡 VideoStudio missing motion brush

For drawn camera paths Runway Gen-4.5 is best-in-class. Veo doesn't support it.
**Fix:** Phase 5.

### 4.8 🟡 CORS wide open

`backend/main.py:26` is `origins: "*"` despite `ALLOWED_ORIGINS` env existing.
**Fix:** Phase 0.

### 4.9 🟡 503 fallback silently downgrades

Pro→Flash fallback in `generate-image` does not tell the user.
**Fix:** Phase 0 (and resurfaces in Phase 1 as GPT→Gemini fallback).

### 4.10 🟡 `__pycache__` tracked by git

`backend/__pycache__/main.cpython-314.pyc` shows as modified in `git status`. `.gitignore` doesn't exclude `__pycache__/`.
**Fix:** Phase 0.

---

## 5. Roadmap

### Phase 0 — Hygiene (3 days)

Pre-flight cleanup. Zero model changes.

- **0.1** `.gitignore`: add `__pycache__/` and `*.pyc`. Untrack the cached `.pyc`.
- **0.2** CORS lockdown:
  ```python
  # backend/main.py:26 — replace
  CORS(app, resources={r"/*": {"origins": "*"}})
  # with
  CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS or ["http://localhost:5173"]}})
  ```
- **0.3** Surface tier-downgrade in response payload. Add `meta.tier_downgrade: true/false` to `/api/generate-image` response. Yellow banner in PhotoEnhancer when set.
- **0.4** Extract model IDs to a single config module:
  ```
  backend/models_config.py     ← all model names + tier mapping
  services/modelConfig.ts      ← TS mirror, single source of truth
  ```
  No behavior change. This is the seed for Phase 1's swap.
- **0.5** Add `dryRun: true` flag to `/api/generate-image` that returns final prompt + tier + provider + model + estimated cost *without* calling the model. Used from AdminDashboard for prompt debugging.

**Definition of done:** Clean `git status`, CORS locked, downgrade visible, one place to change model IDs, dry-run mode working.

---

### Phase 1 — Swap to GPT Image 2 (1–2 weeks)

The whole point of v3. Concrete, narrow, high-impact.

#### 1.1 OpenAI client + key

```bash
# .env additions
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_TIMEOUT_S=60
```

```python
# backend/openai_client.py — NEW
import os
from openai import OpenAI

_client = None

def get_openai_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.environ["OPENAI_API_KEY"],
            timeout=float(os.environ.get("OPENAI_IMAGE_TIMEOUT_S", 60)),
        )
    return _client
```

Add `openai>=1.40.0` to `backend/requirements.txt`.

#### 1.2 Refactor `/api/generate-image` to route by tier

Tier 0 stays on Gemini Flash. Tiers 1/2/3 go to GPT Image 2. Gemini Pro stays in the codebase as silent fallback.

```python
# backend/models_config.py — NEW (from Phase 0.4)
GEMINI_FAST_IMAGE = "gemini-2.5-flash-image"
GEMINI_PRO_IMAGE  = "gemini-3-pro-image-preview"  # now fallback only
OPENAI_IMAGE      = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")

TIER_CONFIG = {
    0: {"provider": "gemini", "model": GEMINI_FAST_IMAGE, "size": None,   "n": 4, "label": "Draft"},
    1: {"provider": "openai", "model": OPENAI_IMAGE,      "size": "1024x1024", "n": 2, "label": "Standard"},
    2: {"provider": "openai", "model": OPENAI_IMAGE,      "size": "1536x1024", "n": 2, "label": "HD"},
    3: {"provider": "openai", "model": OPENAI_IMAGE,      "size": "2048x2048", "n": 1, "label": "Ultra"},
}

FALLBACK_CHAIN = {
    "openai": [("gemini", GEMINI_PRO_IMAGE), ("gemini", GEMINI_FAST_IMAGE)],
    "gemini": [("gemini", GEMINI_FAST_IMAGE)],
}
```

#### 1.3 OpenAI image call — text-to-image path

```python
def openai_generate(prompt: str, n: int, size: str) -> List[bytes]:
    client = get_openai_client()
    resp = client.images.generate(
        model=OPENAI_IMAGE,
        prompt=prompt,
        n=n,
        size=size,
        quality="high",        # GPT Image 2 quality knob
        response_format="b64_json",
    )
    return [base64.b64decode(d.b64_json) for d in resp.data]
```

#### 1.4 OpenAI image call — image-to-image with mask + reference

```python
def openai_edit(prompt: str, image_bytes: bytes, mask_bytes: Optional[bytes],
                reference_bytes: Optional[bytes], n: int, size: str) -> List[bytes]:
    client = get_openai_client()
    # gpt-image-2 image edit endpoint accepts the source image and an optional mask.
    # Reference image is sent as a second input image in the same call.
    images = [("image", ("source.png", image_bytes, "image/png"))]
    if reference_bytes:
        images.append(("image", ("reference.png", reference_bytes, "image/png")))
    kwargs = {
        "model": OPENAI_IMAGE,
        "prompt": prompt,
        "n": n,
        "size": size,
        "response_format": "b64_json",
    }
    if mask_bytes:
        kwargs["mask"] = ("mask.png", mask_bytes, "image/png")
    resp = client.images.edit(**kwargs, files=images)
    return [base64.b64decode(d.b64_json) for d in resp.data]
```

> **Verify on first integration:** OpenAI may evolve the SDK shape between SDK versions; the above is the May 2026 expected interface. If `images.edit` does not accept a second reference image directly, fold it into the prompt as a system message that references `image[1]` — GPT Image 2 supports multi-image input in the same call.

#### 1.5 Wire the dispatcher in `/api/generate-image`

```python
@app.route("/api/generate-image", methods=["POST"])
@require_auth
def generate_image():
    t_start = time.time()
    data = request.json
    tier = max(0, min(3, int(data.get("qualityTier", 2))))
    cfg = TIER_CONFIG[tier]

    image_b64 = data.get("image")
    mask_b64  = data.get("mask")
    ref_b64   = data.get("referenceImage")
    prompt    = data.get("prompt", "") + QUALITY_PROMPT_SUFFIX.get(tier, "")
    system_instruction = data.get("systemInstruction", "")

    # Compose system instruction into prompt for OpenAI (no separate field there)
    if cfg["provider"] == "openai" and system_instruction:
        prompt = f"{system_instruction}\n\n---\n\n{prompt}"

    attempts = [(cfg["provider"], cfg["model"])] + FALLBACK_CHAIN.get(cfg["provider"], [])
    last_error = None
    used_provider, used_model, downgraded = None, None, False

    for idx, (provider, model) in enumerate(attempts):
        try:
            if provider == "openai":
                if image_b64:
                    images = openai_edit(prompt, b64dec(image_b64), b64dec(mask_b64),
                                         b64dec(ref_b64), cfg["n"], cfg["size"])
                else:
                    images = openai_generate(prompt, cfg["n"], cfg["size"])
            else:  # gemini
                images = gemini_generate(prompt, system_instruction, image_b64, mask_b64,
                                         ref_b64, model, cfg["size"], cfg["n"])
            used_provider, used_model = provider, model
            downgraded = idx > 0
            break
        except Exception as e:
            last_error = e
            app.logger.warning(f"[generate-image] {provider}/{model} failed: {e}")

    if not images:
        return jsonify({"error": str(last_error)}), 500

    # Log usage
    log_usage(request.user_id, "generate-image", used_model, tier,
              None, int((time.time()-t_start)*1000), True, provider=used_provider)

    return jsonify({
        "images": [f"data:image/png;base64,{base64.b64encode(b).decode()}" for b in images],
        "meta": {
            "provider": used_provider,
            "model": used_model,
            "tier": tier,
            "tier_downgrade": downgraded,
            "n": len(images),
        },
    })
```

#### 1.6 Cost cap per user per day

`usage_logs` already records `estimated_cost_usd`. Add:

```python
DAILY_USER_CAP_USD = float(os.environ.get("DAILY_USER_CAP_USD", 25.0))

def check_user_budget(user_id: str) -> Tuple[bool, float]:
    """Returns (ok_to_spend, spent_today_usd)."""
    today_iso = datetime.utcnow().strftime("%Y-%m-%d")
    rows = sb_get(f"usage_logs?user_id=eq.{user_id}&created_at=gte.{today_iso}T00:00:00&select=estimated_cost_usd")
    spent = sum(float(r.get("estimated_cost_usd", 0)) for r in rows)
    return spent < DAILY_USER_CAP_USD, spent
```

Call at the top of `generate_image`. If cap exceeded, force `tier=0` and return with `meta.cap_hit=true` so the UI can show a banner.

OWNER_USER_ID is exempt (Juan).

#### 1.7 Update pricing table for OpenAI

`backend/main.py:86` has `GEMINI_PRICING`. Rename to `MODEL_PRICING` and add:

```python
MODEL_PRICING = {
    "gemini-2.5-flash-image":      {"per_image": 0.005},
    "gemini-2.5-flash":            {"input": 0.000075, "output": 0.000300},
    "gemini-3-pro-image-preview":  {"per_image": 0.080},
    "gpt-image-2": {
        # OpenAI bills per image at output size, plus reasoning tokens
        # Confirmed prices at integration time — placeholders below
        "1024x1024": {"per_image": 0.080},
        "1536x1024": {"per_image": 0.120},
        "2048x2048": {"per_image": 0.250},
        "reasoning_per_1k_tokens": 0.015,
    },
}
```

Update `log_usage` to handle per-image pricing (not just per-token) for image models.

#### 1.8 Frontend: handle multi-image return

`generateArchitecturalVariations` already returns `images: string[]`. Today the array has length 1; with GPT Image 2 it has length 2 at Std/HD or 1 at Ultra. The frontend `PhotoEnhancer.tsx` already grids 2-up when `step.images.length > 1` (line 458) — so display works.

What's missing: the user needs to *pick* one of the variations as the active one going forward. The `selectedImageIndex` mechanism (PhotoEnhancer.tsx:462-466) already does this. Just confirm it works when N>1 and add a "Use this one" affirmation to the UX.

Add a small `n` knob in the quality tier selector area:
- Draft (Tier 0): n=4 (lots of cheap drafts)
- Standard (Tier 1): n=2
- HD (Tier 2): n=2 (default)
- Ultra (Tier 3): n=1 (one polished hero)

Override-able per call.

#### 1.9 Latency UX

GPT Image 2 with reasoning runs ~15–25s for HD. Today the user sees a spinner with no progress info — they will think the app froze.

Update `generationPhase` states in `PhotoEnhancer.tsx`:

```typescript
// Replace current flat phases with a progress sequence
setGenerationPhase('🧠 Classifying intent...');         // ~1s
// ...
setGenerationPhase('🔬 Analyzing scene...');             // ~2s
// ...
setGenerationPhase('💭 Model is reasoning before drawing...');  // ~5-8s on OpenAI side
// ...
setGenerationPhase('🎨 Generating render...');           // ~10-15s
```

We can't observe OpenAI's internal reasoning progress, but we can fake it with timed transitions based on the empirical latency distribution. Better than a static spinner.

#### 1.10 Acceptance criteria

- A single `qualityTier` change in the UI switches between Gemini Flash and GPT Image 2 with no other code path differences.
- A user with `tier=2` gets 2 images back from GPT Image 2 by default.
- If OpenAI returns 429/503, the request silently falls through to Gemini Pro and the response shows `tier_downgrade=true`.
- The yellow downgrade banner appears in PhotoEnhancer when `tier_downgrade=true`.
- Daily cap stops further OpenAI calls and forces Tier 0 with a UI banner.
- AdminDashboard's "by_model" breakdown shows `gpt-image-2` rows.

**Effort estimate:** 1.5 weeks single dev.

---

### Phase 2 — Cumulative context lineage (1 week)

Closes plan-v1 #3, #6. Lighter than v2 because we don't need our own critique loop anymore (GPT Image 2 does it internally).

#### 2.1 EditLineage type

```typescript
// types.ts
export interface EditLineage {
  originalImageHash: string;
  originalSceneAnalysis: SceneAnalysis;
  edits: Array<{
    userCommand: string;
    intent: EditIntent;
    timestamp: number;
  }>;
}
```

Add `lineage?: EditLineage` to `DesignStep`.

#### 2.2 Pass lineage into every generation

When iteration N runs, prepend to the prompt:

```
DESIGN LINEAGE (iteration ${N} of an ongoing architectural design):
Original scene: ${lineage.originalSceneAnalysis.description}
Original camera: ${lineage.originalSceneAnalysis.cameraAngle} (KEEP unchanged across all iterations)
Previous edits (apply cumulatively):
  1. ${edits[0].userCommand}
  2. ${edits[1].userCommand}
  ...
New instruction to apply on top: "${currentCommand}"
```

This pins the original anchor and prevents drift.

#### 2.3 Anchor scene analysis

`analyzeScene` is currently called on the *latest* image. Change `geminiService.ts` so that on the *first* edit, the scene analysis is computed on the original input and cached in `EditLineage.originalSceneAnalysis`. Subsequent iterations re-use it.

For iterations >1, optionally also analyze the *latest* image for delta detection ("what changed in the last render"), but the anchor is the original.

#### 2.4 Acceptance criteria

- Edit chain of 5 commands: each prompt includes the prior 4 as cumulative context.
- Original camera angle is preserved across all 5 (visually verified on a 10-input test set).
- No regressions in single-shot edits.

**Effort estimate:** 1 week.

---

### Phase 3 — Plan→Render with Flux + ControlNet (3 weeks)

The single biggest perceived-quality bug in the product. **This is the one place where we are not all-in on OpenAI.**

GPT Image 2 will *not* respect floor plan geometry. It interprets the plan visually like Gemini does — sometimes well, sometimes inventing walls. The only mature path for plan-to-render with locked geometry is **Flux + Depth + Canny ControlNet**.

#### 3.1 Compute Canny + Depth maps from the plan

Two paths:

**Path A — From vector data (when DXF is parsed):**
We already parse DXF into a `FloorPlan` type with walls/doors/windows as coordinates. Render this directly to a clean Canny-style edge map and synthesize a depth map (assign each room a depth based on its area or label). No ML needed.

**Path B — From raster plan (PNG upload):**
Use `controlnet_aux` server-side:
- Canny: `from controlnet_aux import CannyDetector` → returns edge PNG
- Depth: `from controlnet_aux import MiDaSDetector` → returns depth PNG

Either way, we end up with 3 inputs ready: source plan PNG + Canny PNG + Depth PNG.

#### 3.2 Flux call with conditioning

```python
# backend/bfl_client.py — NEW
def flux_plan_to_render(plan_b64: str, canny_b64: str, depth_b64: str,
                        prompt: str, canny_strength=0.8, depth_strength=0.6) -> bytes:
    # BFL endpoint or fal.ai / Replicate proxy depending on auth setup
    ...
```

Production target: BFL's API for `flux-1.1-pro-ultra` with ControlNet. Backup: fal.ai or Replicate hosting `flux-1-dev` with the same ControlNets.

#### 3.3 New endpoint `/api/plan-to-render`

Replaces the current path in `PlanToRender.tsx` for RENDER mode (line 308 onwards). 2D Modify mode is unchanged — it still uses Gemini Flash for vector ops.

#### 3.4 UI: Geometry Lock slider

In `PlanToRender.tsx` RENDER mode, add a slider 0–100%:
- 100% = canny_strength=1.0, depth_strength=1.0 (model literally cannot move walls)
- 50% = canny_strength=0.7, depth_strength=0.5 (default, balanced)
- 0% = no ControlNet (fall back to GPT Image 2 / Gemini, current behavior)

#### 3.5 Vector op validation (plan-v1 #9)

In `cadService.ts`, before applying AI-returned operations:
```typescript
function validateOperations(ops: PlanOperation[], plan: FloorPlan): {ok: boolean, errors: string[]} {
  const errors: string[] = [];
  const bounds = getPlanBounds(plan);
  for (const op of ops) {
    if (op.type === 'add_wall') {
      if (op.start.x < bounds.minX - 1000 || op.start.x > bounds.maxX + 1000) errors.push(`wall ${op.id}: x out of bounds`);
      const len = Math.hypot(op.end.x - op.start.x, op.end.y - op.start.y);
      if (len < 100 || len > 100000) errors.push(`wall ${op.id}: length ${len} unreasonable`);
    }
    // ... door, window, room validations
  }
  return {ok: errors.length === 0, errors};
}
```

If validation fails, show error to user with the specific failure rather than silently corrupting the plan.

#### 3.6 Acceptance criteria

- Build a regression set of 10 floor plans with reference renders.
- For each: upload plan, render with "modern style, morning light", verify all walls remain in the same locations (within 5% tolerance) using a wall-detection script on the output.
- Target: >90% pass rate at Geometry Lock = 50%.

**Effort estimate:** 3 weeks (the ControlNet plumbing and the BFL client are the bulk).

---

### Phase 4 — Real upscaler (2 weeks)

Closes new issue 4.3.

#### 4.1 Replace `/api/enhance-image` with a real upscaler

Provider order:
1. **Krea Upscale** (default) — best general performer, up to 22K, creativity knob.
2. **Recraft Upscale** — cheaper fallback.
3. **Current Gemini-pass** — last-resort fallback (rename to `enhance-image-legacy`).

#### 4.2 UI: Creativity slider

Krea exposes `creativity` 0–10. Default 2 for architectural work (faithful, no invention). Slider in PhotoEnhancer's Enhance button:
- **Conservative (0–3):** restore detail, do not invent
- **Balanced (4–6):** moderate detail addition
- **Aggressive (7–10):** hyperreal detail, may invent — warn user

#### 4.3 Always upscale at the download boundary

When the user clicks Download, offer 2K (current) or 4K (auto-upscale before download). Eliminates the "enhance everything in the UI" antipattern.

#### 4.4 Cost gating

Same daily $ cap as Phase 1.6 applies. Krea/Magnific calls show estimated cost in a confirmation modal before firing.

#### 4.5 Acceptance criteria

- 20-input visual A/B: current "enhance" vs Krea — target >70% Krea preference in blind test.
- No design changes introduced at Conservative tier (visually confirmed on the 20-input set).

**Effort estimate:** 2 weeks.

---

### Phase 5 — Video upgrade (2 weeks)

Closes 4.6, 4.7, plan-v1 #10, #12.

#### 5.1 Video quality tier

| Tier | Provider | Model | Length | Resolution |
|---|---|---|---|---|
| Draft | Google | veo-3.1-fast | 8s | 720p |
| Standard | Google | veo-3.1 | 16s | 1080p |
| HD | Google | veo-3.1 | 30s | 1080p |
| Ultra | Google or Kling | veo-3.1 or kling-3.0 | 60s | 1080p / 4K opt |

Default: HD.

#### 5.2 Runway Gen-4.5 for motion brush

Add "Custom Camera Path" mode to `VideoStudio.tsx`. User draws an arrow on the image to indicate camera direction; we send it to Runway as the motion brush input. Only this mode goes to Runway — Veo remains default for canned presets.

#### 5.3 RenderAsset gets scene metadata (plan-v1 #12)

```typescript
interface RenderAsset {
  id: string; url: string; type: 'IMAGE'|'VIDEO'; source: PageRole;
  prompt: string; timestamp: number;
  sceneAnalysis?: SceneAnalysis;   // NEW — inject into Veo/Runway prompts
  originalPrompt?: string;         // NEW
  editLineage?: EditLineage;       // NEW (from Phase 2)
  provider?: string;               // NEW
  modelVersion?: string;           // NEW
}
```

Video generation uses `sceneAnalysis.lighting` and `sceneAnalysis.architecture` to inform the Veo/Runway prompt — preserves the room's identity in the video.

#### 5.4 Negative prompt UI

Currently hardcoded. Expose in Advanced toggle:
```
DEFAULT: cartoon, drawing, low quality, blurry, distorted, deformed walls,
broken geometry, illegible architecture, melted materials, floating furniture
```

**Effort estimate:** 2 weeks.

---

### Phase 6 — Nice-to-haves (open-ended)

- **6.1** Real undo stack (plan-v1 #11). Steps become a DAG, branches preserved.
- **6.2** Multi-output PDF export — 4-page client deliverable from one session.
- **6.3** Before/after comparison export — animated wipe.
- **6.4** Depth + normal map side-outputs from Flux Tools (Phase 3+).
- **6.5** Smart preset suggestions — contrast-aware ("scene is minimalist → suggest industrial / biophilic, not minimalist").

---

## 6. Quality measurement — how we'll know we're winning

### 6.1 Internal benchmark set (30 inputs)

Locked in `tests/benchmarks/`:
- 10 architectural photos for edits (with locked instructions)
- 10 floor plans (with prompts)
- 10 text-only prompts

Each has a 5-question acceptance rubric. Total possible: 150 points.

### 6.2 Quality dashboard

`AdminDashboard.tsx` "Benchmarks" tab. Weekly: run 30 inputs through current production + each new path.

Goal: hit GPT Image 2 baseline at the **end of Phase 1**, exceed it (via Phase 2 lineage + Phase 3 plan-locked renders) by end of Phase 3.

### 6.3 In-production signals

Already logging every gen. Add:
- **Implicit accept:** no re-prompt within 60s
- **Implicit reject:** user re-prompted with corrective phrase ("no, like this", "actually", "but darker")
- **Enhance click:** indicates accept-of-composition but want-of-detail

Aggregate weekly. Lead indicator: **implicit-accept rate by provider × tier**.

### 6.4 Honest comparison vs ChatGPT

Weekly: pick 5 random user prompts from last week's logs. Run blind through ArquiVision and ChatGPT. Score blind. If we're losing >60% on hero-tier renders, we are still losing the war regardless of internal benchmarks.

---

## 7. Risks and decisions

### 7.1 Cost blowout
GPT Image 2 at HD ≈ 3× Gemini Pro. At Ultra ≈ 5×. **The daily $ cap in Phase 1.6 is non-negotiable.** Without it, a single power user can 10× the bill in a week.

### 7.2 Latency tax
Reasoning loop adds ~10s wall clock. Mitigations: keep Gemini Flash on Tier 0 (sub-3s), good UI progress states (Phase 1.9), encourage Draft tier for iteration in onboarding copy.

### 7.3 Vendor risk
Single-vendor again, just OpenAI this time. Mitigations: Gemini Pro stays as silent fallback (we still have the code path); the model_config.py abstraction lets us swap providers in days, not weeks.

### 7.4 OpenAI rate limits
gpt-image-2 is in preview; new accounts have low daily limits. Apply for the rate-limit increase **on day 1 of Phase 0** so it's resolved by Phase 1 start.

### 7.5 Spanish architectural vocabulary
The intent classifier in Spanish is a moat. Verify on first integration that GPT Image 2 respects "cornisa", "cuarterón", "rosetón" with same fidelity as Gemini. If not, enrich the prompt scaffolding with literal English translations as parenthetical hints. Likely a non-issue: GPT Image 2 trained on more multilingual data than Gemini, and architectural terms are common.

### 7.6 Model deprecation
gpt-image-2 is currently the latest. OpenAI's pattern is to ship a successor (gpt-image-3?) within 6–9 months. The `OPENAI_IMAGE_MODEL` env var lets us bump without a code change.

---

## 8. What to do this week

1. **Day 1 (today).** Phase 0.1–0.4 — clean `.gitignore`, lock CORS, extract model IDs, surface tier-downgrade. One PR.
2. **Day 1 (today, parallel).** Apply for OpenAI API key with `gpt-image-2` entitlements + rate-limit increase. Has approval lag.
3. **Day 2.** Phase 0.5 — dry-run mode + benchmark set spec.
4. **Day 3–4.** Curate the 30-input benchmark set (§6.1). Score current Gemini production as baseline.
5. **Day 5–7.** Start Phase 1.1–1.3 — wire OpenAI client + the dispatch refactor. Skeleton only; no UI changes yet.

By the time the API key clears, the swap is one config change away from going live.

---

## 9. Appendix — Prompt upgrades that ship with Phase 1

### 9.1 System instruction adapted for GPT Image 2

GPT Image 2 takes the system instruction as a prefix in the prompt itself (unlike Gemini which has a separate `system_instruction` field). The existing `AI_ROLES.PHOTO` text in `autocadService.ts` mostly works as-is, but tighten it:

- Drop the multi-paragraph wall-of-text style; GPT Image 2 follows checklists better.
- Move the architectural vocabulary into a compact glossary block at the top.
- Add a "verification" line at the bottom that hints at the reasoning loop: "Before producing the final image, internally verify: did you apply every change the user requested? are the elements they asked to keep preserved exactly?"

### 9.2 Quality suffix as checklist (not adjective stack)

Replace current Tier 3 suffix with:
```
OUTPUT QUALITY — Ultra 4K. Verify before finalizing:
[ ] Every material surface shows visible texture (wood grain, stone veining, fabric weave)
[ ] Shadows have correct soft falloff and contact darkening
[ ] Specular highlights present on glass, metal, polished surfaces
[ ] Reflections in mirrors and water are geometrically correct
[ ] No banding in color gradients
[ ] No jagged edges on furniture silhouettes
[ ] Window exteriors are photographic, not painterly
[ ] Any visible text is legible and spelled correctly
```

GPT Image 2's reasoning loop will literally treat these as a checklist.

### 9.3 Negative anchors per page role

Append to each system role:
```
NEGATIVE — do NOT produce: illustrated style, watercolor, painterly brushstrokes,
plastic-looking materials, duplicated objects, floating furniture, walls that
don't meet the floor, light fixtures with no power source, windows looking
onto solid color, melted-glass effect, deformed chairs, hands with extra
fingers, text that is not real text.
```

### 9.4 Inject scene measurements when available

If the user uploaded a plan and we have room dimensions, inject:
```
Room dimensions: 4.5m × 6.2m × 2.8m (W × D × H).
All furniture must scale correctly to these dimensions.
A standard sofa is ~2.2m wide. A standard door is 0.9m × 2.1m.
```

Costs nothing and meaningfully reduces "couch the size of a building" failures.

### 9.5 Preset templates that close over scene

```typescript
{
  id: 'british-georgian',
  label: 'British Georgian',
  template: (scene: SceneAnalysis) => `
    Apply British Georgian style with full commitment:
    - Walls: pale sage green or wedgewood blue
    - Cornices: deep classical profile at all wall-ceiling junctions
    - Windows: ${scene.objects.includes('window') ? 'maintain existing openings, add 6-over-6 sash glazing' : 'add proportional sash windows where space permits'}
    - Floor: wide-plank oak in herringbone or straight lay
    - Lighting: ${scene.lighting} (preserve direction and warmth)
    - Camera: ${scene.cameraAngle} (locked)
    Maintain photoreal materials, correct shadow physics, no painterly artifacts.
  `
}
```

---

## 10. Document maintenance

- **Owner:** Juan
- **Review cadence:** every 4 weeks or on shipping a phase, whichever sooner.
- **Where this lives:** `.agents/arquivision_improvement_plan.md` (in repo). Summary mirrored in `~/.claude/projects/-Users-bender/memory/project_arquivision_ai.md`.
- **When to bump to v4:** when a flagship image model ships (gpt-image-3, gemini-4-pro-image, flux-2) and the tier mapping needs re-prioritization; or when we add a non-architecture use case.
