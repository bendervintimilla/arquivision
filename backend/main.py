"""
Archivision AI - Backend Proxy for Gemini API
Secures the Gemini API key server-side and validates Supabase JWTs.
Edit Intelligence Engine: intent classification, scene analysis, creative dataset tracking.
"""
import os
import base64
import json
import time
from functools import wraps

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(override=True)

app = Flask(__name__)

# Allow large payloads (up to 50MB) for image+video workflows
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

# SECURITY: Restrict CORS to known frontend origins only.
# Set ALLOWED_ORIGINS env var as a comma-separated list of allowed origins.
# In dev (no env), defaults to local Vite/CRA ports. In prod, ALLOWED_ORIGINS
# MUST be set to the deployed frontend URL — leaving it unset will not open
# CORS to the world like before.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]
)
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}})

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "") or SUPABASE_ANON_KEY  # fallback
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

# Model constants — single source of truth lives in models_config.py
# Phase 1 will flip tier 1/2/3 to OpenAI by editing only that file.
from models_config import (
    GEMINI_PRO_IMAGE as IMAGE_MODEL,
    GEMINI_FAST_IMAGE as FAST_IMAGE_MODEL,
    GEMINI_FAST_TEXT as FAST_MODEL,
    VIDEO_MODEL,
)

# ---------- Auth Middleware ----------

SKIP_AUTH = os.environ.get("SKIP_AUTH", "false").lower() == "true"

def require_auth(f):
    """Validate Supabase JWT from Authorization header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if SKIP_AUTH:
            request.user_id = "local-dev-user"
            return f(*args, **kwargs)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing authorization token"}), 401

        token = auth_header.split("Bearer ")[1]

        # Validate JWT via Supabase REST API
        import urllib.request
        req = urllib.request.Request(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_ANON_KEY,
            }
        )
        try:
            with urllib.request.urlopen(req) as resp:
                user_data = json.loads(resp.read().decode())
                request.user_id = user_data.get("id")
        except Exception as e:
            return jsonify({"error": "Invalid or expired token"}), 401

        return f(*args, **kwargs)
    return decorated

# ---------- Gemini Client ----------

def get_gemini_client():
    from google import genai
    return genai.Client(api_key=GEMINI_API_KEY)

# ---------- Usage Logging ----------

# Pricing + tier config live in models_config.py — single source of truth.
# Imported here under the legacy names so the rest of main.py keeps working.
from models_config import (
    MODEL_PRICING as GEMINI_PRICING,   # legacy alias
    TIER_CONFIG as QUALITY_TIERS,      # legacy alias
    estimate_image_cost,
)

# Daily per-user OpenAI spend cap (USD). OWNER_USER_ID is exempt.
DAILY_USER_CAP_USD = float(os.environ.get("DAILY_USER_CAP_USD", "25.0"))


def check_user_budget(user_id: str) -> tuple:
    """Return (ok_to_spend, spent_usd_today).

    Sums today's estimated_cost_usd in usage_logs for the user. Soft-fails
    open (returns True) if Supabase is unreachable — the goal is to stop
    runaway spend, not to block the app on monitoring outages.
    """
    if not user_id or user_id == OWNER_USER_ID:
        return True, 0.0
    try:
        import urllib.request as ureq
        from datetime import datetime
        today_iso = datetime.utcnow().strftime("%Y-%m-%d")
        url = (
            f"{SUPABASE_URL}/rest/v1/usage_logs"
            f"?user_id=eq.{user_id}"
            f"&created_at=gte.{today_iso}T00:00:00"
            f"&select=estimated_cost_usd"
        )
        req = ureq.Request(url, headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        })
        with ureq.urlopen(req, timeout=3) as r:
            rows = json.loads(r.read().decode())
        spent = sum(float(row.get("estimated_cost_usd", 0) or 0) for row in rows)
        return spent < DAILY_USER_CAP_USD, spent
    except Exception as e:
        app.logger.warning(f"[budget] check failed (soft-fail open): {e}")
        return True, 0.0


# Owner ID also referenced from /api/admin/usage — declared here so
# check_user_budget can use it. The duplicate assignment near that route
# is preserved below for backwards reading order.
OWNER_USER_ID = "b30e21bf-2aad-477f-93ef-8f6ec4b459c5"

# Quality-tier prompt suffixes — instruct the model to match output quality expectations
QUALITY_PROMPT_SUFFIX = {
    0: "",
    1: "\nOUTPUT QUALITY: High quality architectural render.",
    2: "\nOUTPUT QUALITY: Professional HD quality. Sharp details, accurate material textures, correct lighting physics. No compression artifacts.",
    3: "\nOUTPUT QUALITY: MAXIMUM 4K QUALITY. Ultra-sharp photorealistic render at the highest possible fidelity. "
       "Every material texture, reflection, highlight, and shadow must be pixel-perfect with zero artifacts. "
       "Professional architectural photography standard — equivalent to a high-end DSLR capture. "
       "Render fine details: wood grain, stone veining, fabric weave, metal brushed finish, glass reflections. "
       "Zero blur, zero distortion, zero banding. This is a premium deliverable."
}

def log_usage(user_id, endpoint, model, quality_tier, usage_metadata, duration_ms,
              success=True, image_size=None, n_images=1):
    """Log token usage and estimated cost to Supabase usage_logs table.

    Cost computation auto-selects per-image vs per-token based on the
    pricing entry shape in MODEL_PRICING.
    """
    try:
        input_tokens  = getattr(usage_metadata, 'prompt_token_count', 0) or 0
        output_tokens = getattr(usage_metadata, 'candidates_token_count', 0) or 0
        total_tokens  = getattr(usage_metadata, 'total_token_count', 0) or (input_tokens + output_tokens)

        pricing = GEMINI_PRICING.get(model, {})
        # Image models: charge per output image (by size if available)
        if "per_image" in pricing or "per_image_by_size" in pricing:
            cost_usd = estimate_image_cost(model, image_size) * max(1, n_images)
        # Text/vision models: per 1K tokens
        elif "input_per_1k" in pricing:
            cost_usd = (
                (input_tokens / 1000) * pricing.get("input_per_1k", 0) +
                (output_tokens / 1000) * pricing.get("output_per_1k", 0)
            )
        else:
            # Legacy fallback for any model lacking a pricing entry
            cost_usd = (input_tokens / 1000) * 0.001 + (output_tokens / 1000) * 0.004

        import urllib.request
        payload = json.dumps({
            "user_id": user_id,
            "endpoint": endpoint,
            "model": model,
            "quality_tier": quality_tier,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "estimated_cost_usd": round(cost_usd, 6),
            "duration_ms": duration_ms,
            "success": success,
        }).encode()

        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/usage_logs",
            data=payload,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            method="POST",
        )
        urllib.request.urlopen(req)
        app.logger.info(f"[usage] {endpoint} | {model} | {total_tokens} tokens | ${cost_usd:.5f}")
    except Exception as e:
        app.logger.warning(f"[usage] Failed to log usage: {e}")

# ---------- Health ----------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "has_key": bool(GEMINI_API_KEY),
        "image_model": IMAGE_MODEL,
        "fast_image_model": FAST_IMAGE_MODEL,
        "fast_model": FAST_MODEL,
    })


# ==============================================
# EDIT INTELLIGENCE ENGINE — NEW ENDPOINTS
# ==============================================

@app.route("/api/classify-intent", methods=["POST"])
@require_auth
def classify_intent():
    """Classify user's editing intent using fast model with architectural vocabulary."""
    try:
        data = request.json
        command = data.get("command", "")

        from google.genai import types

        client = get_gemini_client()

        prompt = f"""
Classify this architectural editing command. Return ONLY valid JSON, no markdown.

USER COMMAND: "{command}"

ARCHITECTURAL VOCABULARY GUIDE (Spanish → English):
- cornisa/cornisas = cornice/cornices (decorative molding at ceiling-wall junction)
- moldura/molduras = molding/trim (decorative wall panel frames)
- cuarterón/cuarterones = panel/panels (recessed wall sections between moldings)
- zócalo = baseboard/skirting board
- hueco/vano = opening/span/reveal
- encimera = countertop
- faja perimetral = perimeter border/trim band on floor
- al raz de / al raz = flush with (exactly level/aligned)
- peninsula = kitchen peninsula/breakfast bar
- focos = light fixtures/spotlights/downlights
- papel tapiz = wallpaper
- despiece = tile pattern/layout scheme
- rosetón = ceiling rose/medallion
- vigas = beams (structural or decorative)
- tabique/muro = wall/partition
- rodear/enmarcar = to frame/surround an element (e.g. "molduras que rodeen la TV")

Return this exact JSON structure:
{{
  "mode": "EDIT" or "GENERATE" or "STYLE_TRANSFER" or "REMOVE_OBJECTS" or "PRECISION_EDIT",
  "scale": "MACRO" or "DETAIL" or "MIXED",
  "preserveLayout": true/false,
  "preserveLighting": true/false,
  "preservePerspective": true/false,
  "elementsToChange": ["list", "of", "specific", "elements"],
  "elementsToKeep": ["list", "of", "elements"],
  "targetStyle": "style name or null",
  "confidence": 0.0-1.0,
  "suggestMask": true/false,
  "framingTarget": "element being framed/surrounded or null",
  "framingElement": "element used to frame (e.g. molduras, cornisas) or null",
  "is3DRotation": true/false,
  "spatialWarning": "string explaining why this is structurally hard, or null"
}}

3D ROTATION / SPATIAL REARRANGEMENT DETECTION (critical — high failure rate):
Set is3DRotation=true and provide spatialWarning when the user asks for:
- Physical rotation of objects: "gira", "rotar", "rotate", "voltear", "flip"
- Reorientation: "que quede dando la espalda a X", "facing the other way", "hacia la ventana"
- Degree-based rotation: "90°", "90 grados", "180°", "180 degrees"
- Moving furniture to a different physical position: "muévelo al otro lado", "ponlo en el lado opuesto"
- Camera-relative changes: "vista desde el otro ángulo", "view from the other side"

When is3DRotation=true, set spatialWarning to a short Spanish message like:
"Las rotaciones 3D de muebles son notoriamente difíciles para modelos image-to-image — el AI no puede ver las caras ocultas del objeto. Considera regenerar la habitación con el nuevo layout desde cero o subir una foto de referencia desde el ángulo deseado."

If the request is NOT a 3D rotation, set is3DRotation=false and spatialWarning=null.

CLASSIFICATION RULES:
- PRECISION_EDIT: Small, localized changes affecting <10% of image (change cornice profile, adjust fixture size, change door handle, change specific molding style, adjust countertop thickness, move a switch). Set suggestMask=true.
- EDIT: Medium scope changes (change floor material, add furniture, change wall color).
- STYLE_TRANSFER: Change the whole design style of the room.
- REMOVE_OBJECTS: Delete/remove specific things from the image.
- GENERATE: Create a completely new image from text description.

scale RULES:
- DETAIL: Changes affect <10% of the image (adjust a cornice, move a switch, change a handle, modify molding profile)
- MACRO: Changes affect >50% of the image (full style change, entire floor replacement)
- MIXED: Multiple changes at different scales

FRAMING DETECTION:
- If the user says "rodear", "rodeen", "enmarcar", "enmarquen", "alrededor de", "que no pasen por detrás", "que las molduras rodeen" → set framingTarget to the element being framed (e.g. "TV") and framingElement to what frames it (e.g. "molduras").

For PRECISION_EDIT, EDIT, STYLE_TRANSFER, REMOVE_OBJECTS: preserveLayout/Lighting/Perspective should be TRUE.
For GENERATE: all preserve flags should be FALSE.
"""

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[types.Part.from_text(text=prompt)],
            config={"response_mime_type": "application/json"},
        )

        intent = json.loads(response.text or "{}")
        return jsonify({"intent": intent})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analyze-scene", methods=["POST"])
@require_auth
def analyze_scene():
    """Analyze an image's scene for editing context."""
    try:
        data = request.json
        image_base64 = data.get("image", "")

        from google.genai import types

        client = get_gemini_client()
        clean = image_base64.split(",")[1] if "," in image_base64 else image_base64

        prompt = """
Analyze this image in detail for an architectural editing task. Return ONLY valid JSON, no markdown.

{
  "description": "One sentence describing the overall scene",
  "objects": ["list", "every", "visible", "object"],
  "architecture": "Describe the architectural style, building type, materials",
  "cameraAngle": "Describe the exact camera position, angle, height, and FOV",
  "lighting": "Describe the lighting conditions: type, direction, color temperature, intensity",
  "colorPalette": ["list", "dominant", "colors", "and", "materials"],
  "spatialLayout": "Describe the spatial arrangement: room shape, dimensions, depth, key reference points"
}

Be extremely precise about camera angle and spatial layout.
"""

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[
                types.Part.from_bytes(data=base64.b64decode(clean), mime_type="image/png"),
                types.Part.from_text(text=prompt),
            ],
            config={"response_mime_type": "application/json"},
        )

        analysis = json.loads(response.text or "{}")
        return jsonify({"analysis": analysis})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/save-creative-data", methods=["POST"])
@require_auth
def save_creative_data():
    """Save a creative datapoint to the learning database."""
    try:
        data = request.json
        user_id = request.user_id

        # Forward the user's JWT to Supabase so RLS can verify auth.uid()
        user_jwt = request.headers.get("Authorization", "").replace("Bearer ", "")
        anon_key = os.environ.get("SUPABASE_ANON_KEY", "")

        import urllib.request
        payload = json.dumps({
            "user_id": user_id,
            "input_scene_analysis": data.get("input_scene_analysis"),
            "user_command": data.get("user_command", ""),
            "detected_intent": data.get("detected_intent"),
            "prompt_sent": data.get("prompt_sent", ""),
            "model_used": data.get("model_used", IMAGE_MODEL),
            "user_accepted": data.get("user_accepted", True),
            "user_regenerated": False,
            "page_source": data.get("page_source", "PHOTO"),
            "style_tags": data.get("style_tags", []),
            "object_tags": data.get("object_tags", []),
        }).encode()

        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/creative_datasets",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "apikey": anon_key,
                "Authorization": f"Bearer {user_jwt}",
                "Prefer": "return=representation",
            }
        )

        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            row_id = result[0]["id"] if isinstance(result, list) and result else "saved"

        app.logger.info(f"[save-creative-data] Saved datapoint {row_id} for user {user_id[:8]}...")
        return jsonify({"id": row_id})

    except Exception as e:
        app.logger.error(f"[save-creative-data] Error: {str(e)}")
        return jsonify({"error": str(e), "id": "error"}), 500


# ==============================================
# IMAGE GENERATION (UPGRADED MODEL)
# ==============================================

@app.route("/api/generate-image", methods=["POST"])
@require_auth
def generate_image():
    """Image generation/editing endpoint. Dispatches to OpenAI (gpt-image-2)
    or Gemini based on tier config. Cost-capped per user per day."""
    t_start = time.time()
    quality_tier = 2  # default HD
    selected_model = IMAGE_MODEL
    requested_model = IMAGE_MODEL
    tier_downgrade = False  # set True when fallback fires (OpenAI→Gemini or 503)
    cap_hit = False         # set True when user hit DAILY_USER_CAP_USD
    spent_today = 0.0
    try:
        data = request.json
        prompt = data.get("prompt", "")
        system_instruction = data.get("systemInstruction", "")
        image_base64 = data.get("image")
        image_mime = data.get("imageMime", "image/png")
        mask_base64 = data.get("mask")
        reference_base64 = data.get("referenceImage")
        reference_mime = data.get("referenceImageMime", "image/png")
        # Phase 6: optional list of additional view images (same space, different
        # angles). Used to resolve 3D rotation / hidden-side requests.
        additional_views = data.get("additionalViews") or []
        if not isinstance(additional_views, list):
            additional_views = []
        additional_views = additional_views[:3]  # cap for cost/latency

        # Quality tier: 0=Draft(flash), 1=Standard(1K), 2=HD(2K), 3=Ultra(4K)
        # Also accept legacy useFastModel=true → tier 0
        quality_tier = int(data.get("qualityTier", 2))
        if data.get("useFastModel", False):
            quality_tier = 0
        quality_tier = max(0, min(3, quality_tier))

        # --- BUDGET CAP ---
        # Tier 0 (Gemini Flash) is cheap enough to always allow; the cap is
        # to stop OpenAI / Pro spend runaway. Owner is exempt.
        if quality_tier > 0:
            ok, spent_today = check_user_budget(getattr(request, 'user_id', None))
            if not ok:
                app.logger.warning(
                    f"[generate-image] User {request.user_id[:8]}... hit daily cap "
                    f"(${spent_today:.2f} >= ${DAILY_USER_CAP_USD:.2f}). Forcing tier 0."
                )
                quality_tier = 0
                cap_hit = True

        tier_cfg = QUALITY_TIERS[quality_tier]
        selected_model = tier_cfg["model"]
        requested_model = selected_model
        image_size = tier_cfg["image_size"]

        from google.genai import types

        client = get_gemini_client()

        parts = []

        if image_base64:
            clean = image_base64.split(",")[1] if "," in image_base64 else image_base64
            parts.append(types.Part.from_bytes(data=base64.b64decode(clean), mime_type=image_mime))

        if mask_base64 and image_base64:
            clean_mask = mask_base64.split(",")[1] if "," in mask_base64 else mask_base64
            parts.append(types.Part.from_bytes(data=base64.b64decode(clean_mask), mime_type="image/png"))

        if reference_base64:
            clean_ref = reference_base64.split(",")[1] if "," in reference_base64 else reference_base64
            parts.append(types.Part.from_bytes(data=base64.b64decode(clean_ref), mime_type=reference_mime))

        # Append quality-tier prompt suffix for better output quality
        quality_suffix = QUALITY_PROMPT_SUFFIX.get(quality_tier, "")
        if quality_suffix:
            prompt = prompt + quality_suffix

        # --- DRY-RUN SHORT-CIRCUIT ---
        # When dryRun=true the caller wants to inspect the final prompt + tier
        # + estimated cost without paying for or waiting on a real generation.
        # Used by AdminDashboard for prompt debugging.
        if data.get("dryRun", False):
            from models_config import estimate_image_cost
            est_cost = estimate_image_cost(selected_model, image_size)
            app.logger.info(f"[generate-image] DRY RUN — tier {quality_tier}, provider {tier_cfg.get('provider', 'gemini')}, model {selected_model}, n={tier_cfg.get('n', 1)}")
            return jsonify({
                "images": [],
                "meta": {
                    "tier": quality_tier,
                    "tier_label": tier_cfg["label"],
                    "tier_downgrade": False,
                    "requested_model": requested_model,
                    "used_model": selected_model,
                    "provider": tier_cfg.get("provider", "gemini"),
                    "n": tier_cfg.get("n", 1),
                    "cap_hit": cap_hit,
                    "spent_usd_today": round(spent_today, 4),
                    "dry_run": True,
                    "final_prompt": prompt,
                    "system_instruction": system_instruction,
                    "image_size": image_size,
                    "has_image": bool(image_base64),
                    "has_mask": bool(mask_base64),
                    "has_reference": bool(reference_base64),
                    "estimated_cost_usd": round(est_cost, 5),
                    # Total est cost = per-image × n (relevant for batches)
                    "estimated_total_cost_usd": round(est_cost * tier_cfg.get("n", 1), 5),
                },
            })

        # --- PROVIDER DISPATCH ---
        # Phase 1: tiers 1/2/3 route to OpenAI gpt-image-2 by default.
        # If OpenAI fails (auth, 429, 5xx, timeout) we mark tier_downgrade
        # and continue into the Gemini path below using GEMINI_PRO_IMAGE.
        provider = tier_cfg.get("provider", "gemini")
        if provider == "openai":
            try:
                from openai_client import openai_generate, openai_edit
                # Prepend the system instruction to the prompt — OpenAI's
                # images.generate / images.edit don't have a separate
                # system_instruction field like Gemini does.
                openai_prompt = prompt
                if system_instruction:
                    openai_prompt = f"{system_instruction}\n\n---\n\n{prompt}"

                app.logger.info(
                    f"[generate-image] OpenAI dispatch — tier {quality_tier} ({tier_cfg['label']}), "
                    f"model {selected_model}, size {image_size}, has_image={bool(image_base64)}, "
                    f"has_mask={bool(mask_base64)}, has_ref={bool(reference_base64)}"
                )

                # Quality knob by tier:
                #   1 (Standard) + 2 (HD): "medium" — favors source fidelity over creative reinvention.
                #     gpt-image-2 at "high" is notorious for hallucinating new architectural elements.
                #   3 (Ultra): "high" — premium hero shot, accepts more creative liberty.
                quality_knob = "high" if quality_tier >= 3 else "medium"

                # If additional views are provided, prepend a structured
                # instruction so the model understands their role.
                if additional_views and image_base64:
                    view_block = (
                        f"\n\n📷 MULTI-VIEW INPUT ({len(additional_views) + 1} images total):\n"
                        "  IMAGE 1: the primary source you must edit.\n"
                        + ("  IMAGE 2: style/material reference (extract aesthetics from here).\n" if reference_base64 else "")
                        + "\n".join([
                            f"  IMAGE {i + 2 + (1 if reference_base64 else 0)}: additional view of the SAME space from a different angle. Use it to understand the geometry, furniture orientation, and hidden surfaces."
                            for i in range(len(additional_views))
                        ])
                        + "\n\nUse all views together to produce a coherent edit. The edit should be consistent with what is visible in ALL views.\n"
                    )
                    openai_prompt = view_block + "\n\n" + openai_prompt

                if image_base64:
                    openai_pngs = openai_edit(
                        prompt=openai_prompt,
                        image_b64=image_base64,
                        mask_b64=mask_base64,
                        reference_b64=reference_base64,
                        additional_views=additional_views,
                        n=tier_cfg.get("n", 1),
                        size=image_size,
                        quality=quality_knob,
                    )
                else:
                    openai_pngs = openai_generate(
                        prompt=openai_prompt,
                        n=tier_cfg.get("n", 1),
                        size=image_size,
                        quality="high",  # text-to-image has no source to preserve
                    )

                if not openai_pngs:
                    raise RuntimeError("OpenAI returned no images")

                images_data_urls = [
                    f"data:image/png;base64,{base64.b64encode(b).decode()}"
                    for b in openai_pngs
                ]
                # Apply the same per-image size log line for parity with the Gemini path
                size_kb = len(openai_pngs[0]) / 1024
                app.logger.info(f"[generate-image] OpenAI success: ~{size_kb:.0f}KB, n={len(images_data_urls)}")

                # Log usage (no token metadata from OpenAI image API — pass None)
                log_usage(
                    request.user_id, "generate-image", selected_model, quality_tier,
                    None, int((time.time() - t_start) * 1000), True,
                )

                return jsonify({
                    "images": images_data_urls,
                    "meta": {
                        "tier": quality_tier,
                        "tier_label": tier_cfg["label"],
                        "tier_downgrade": False,
                        "requested_model": requested_model,
                        "used_model": selected_model,
                        "provider": "openai",
                        "cap_hit": cap_hit,
                        "spent_usd_today": round(spent_today, 4),
                        "n": len(images_data_urls),
                    },
                })

            except Exception as openai_err:
                # OpenAI failed — log it, mark the downgrade, and fall through
                # into the Gemini path below with GEMINI_PRO_IMAGE.
                app.logger.warning(
                    f"[generate-image] OpenAI failed ({type(openai_err).__name__}: {openai_err}), "
                    f"falling back to Gemini Pro"
                )
                selected_model = IMAGE_MODEL  # GEMINI_PRO_IMAGE via alias
                tier_downgrade = True
                # Continue execution into the Gemini code block below.

        parts.append(types.Part.from_text(text=prompt))

        # Build image config based on tier
        image_config = None
        if image_size:
            try:
                image_config = types.ImageConfig(image_size=image_size)
            except Exception as cfg_err:
                app.logger.warning(f"[generate-image] ImageConfig error: {cfg_err}")

        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            system_instruction=system_instruction if system_instruction else None,
            image_config=image_config,
        )

        app.logger.info(f"[generate-image] Tier {quality_tier} ({tier_cfg['label']}) | Model: {selected_model} | Res: {image_size or 'default'} | Has image: {bool(image_base64)}")

        try:
            response = client.models.generate_content(
                model=selected_model,
                contents=parts,
                config=config,
            )
        except Exception as api_err:
            if "503" in str(api_err) and selected_model == IMAGE_MODEL:
                app.logger.warning(f"[generate-image] 503 error with {selected_model}, falling back to {FAST_IMAGE_MODEL}")
                selected_model = FAST_IMAGE_MODEL
                tier_downgrade = True
                
                # Fallback: try Flash model WITH the same image_size config first
                # Flash model supports 1K/2K/4K image_size too
                fallback_config = types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    system_instruction=system_instruction if system_instruction else None,
                    image_config=image_config,  # Preserve image_size for quality
                )
                
                try:
                    response = client.models.generate_content(
                        model=selected_model,
                        contents=parts,
                        config=fallback_config,
                    )
                except Exception as fallback_err:
                    # Last resort: try Flash without image_size config
                    app.logger.warning(f"[generate-image] Flash with image_size failed ({fallback_err}), trying without image_size")
                    bare_config = types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                        system_instruction=system_instruction if system_instruction else None,
                    )
                    response = client.models.generate_content(
                        model=selected_model,
                        contents=parts,
                        config=bare_config,
                    )
            else:
                raise api_err
                
        # Extract image data
        images = []
        text_parts = []
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    img_b64 = base64.b64encode(part.inline_data.data).decode()
                    mime = part.inline_data.mime_type or "image/png"
                    images.append(f"data:{mime};base64,{img_b64}")
                elif hasattr(part, 'text') and part.text:
                    text_parts.append(part.text[:200])

        if not images:
            app.logger.error(f"[generate-image] No images returned. Text parts: {text_parts}")
            log_usage(request.user_id, "generate-image", selected_model, quality_tier, None, int((time.time()-t_start)*1000), False)
            return jsonify({"error": "No image generated — model returned text only", "text": text_parts}), 500

        # Log size
        b64_part = images[0].split(",")[1] if "," in images[0] else images[0]
        size_kb = len(b64_part) * 3 / 4 / 1024
        app.logger.info(f"[generate-image] Success: ~{size_kb:.0f}KB")

        # Log usage to Supabase
        log_usage(request.user_id, "generate-image", selected_model, quality_tier,
                  getattr(response, 'usage_metadata', None), int((time.time()-t_start)*1000))

        return jsonify({
            "images": images,
            "meta": {
                "tier": quality_tier,
                "tier_label": tier_cfg["label"],
                "tier_downgrade": tier_downgrade,
                "requested_model": requested_model,
                "used_model": selected_model,
                "provider": "gemini",
                "cap_hit": cap_hit,
                "spent_usd_today": round(spent_today, 4),
            },
        })

    except Exception as e:
        app.logger.error(f"[generate-image] Exception: {str(e)}")
        log_usage(request.user_id if hasattr(request, 'user_id') else None, "generate-image",
                  selected_model, quality_tier, None, int((time.time()-t_start)*1000), False)
        return jsonify({"error": str(e)}), 500


@app.route("/api/enhance-image", methods=["POST"])
@require_auth
def enhance_image():
    """Dedicated quality enhancement pass — upscale and sharpen an existing render."""
    try:
        data = request.json
        image_base64 = data.get("image", "")

        if not image_base64:
            return jsonify({"error": "No image provided"}), 400

        from google.genai import types

        client = get_gemini_client()
        clean = image_base64.split(",")[1] if "," in image_base64 else image_base64

        enhance_prompt = (
            "ENHANCE this architectural render to MAXIMUM photorealistic quality at 4K resolution. "
            "Do NOT change, add, or remove ANY objects, furniture, materials, colors, or elements. "
            "ONLY improve the following with extreme precision:\n"
            "- SHARPNESS: Every edge must be crisp and well-defined, zero blur\n"
            "- MATERIAL TEXTURES: Enhance wood grain, stone veining, fabric weave, metal finish to photographic detail\n"
            "- LIGHTING: Improve realism of light rays, ambient occlusion, global illumination, caustics\n"
            "- SHADOWS: Accurate soft shadows with correct falloff and contact shadows\n"
            "- REFLECTIONS: Correct specular highlights on glass, polished surfaces, water\n"
            "- ANTI-ALIASING: Smooth all jagged edges, especially on furniture and architectural details\n"
            "- COLOR DEPTH: Rich, natural color gradients with no banding\n"
            "The output must look like a professional DSLR architectural photograph shot on a Phase One camera. "
            "Keep the EXACT same composition, perspective, and content. Zero artifacts."
        )

        parts = [
            types.Part.from_bytes(data=base64.b64decode(clean), mime_type="image/png"),
            types.Part.from_text(text=enhance_prompt),
        ]

        # Use 4K resolution for enhancement (maximum quality)
        image_config_enhance = None
        try:
            image_config_enhance = types.ImageConfig(
                image_size="4K",
            )
        except Exception:
            app.logger.warning("[enhance-image] ImageConfig not supported")

        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=image_config_enhance,
        )

        app.logger.info(f"[enhance-image] Starting quality enhancement at {'4K' if image_config_enhance else 'default'} resolution")

        response = client.models.generate_content(
            model=IMAGE_MODEL,  # Always use pro model for enhancement
            contents=parts,
            config=config,
        )

        images = []
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    img_b64 = base64.b64encode(part.inline_data.data).decode()
                    mime = part.inline_data.mime_type or "image/png"
                    images.append(f"data:{mime};base64,{img_b64}")

        if not images:
            return jsonify({"error": "Enhancement failed — no image returned"}), 500

        app.logger.info(f"[enhance-image] Success")
        return jsonify({"images": images})

    except Exception as e:
        app.logger.error(f"[enhance-image] Exception: {str(e)}")
        return jsonify({"error": str(e)}), 500


# ==============================================
# PLAN ANALYSIS & VECTOR (UPGRADED MODEL)
# ==============================================

@app.route("/api/analyze-plan", methods=["POST"])
@require_auth
def analyze_plan():
    """Proxy for plan analysis via fast model."""
    try:
        data = request.json
        image_base64 = data.get("image", "")
        prompt = data.get("prompt", "")

        from google.genai import types

        client = get_gemini_client()
        clean = image_base64.split(",")[1] if "," in image_base64 else image_base64

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[
                types.Part.from_bytes(data=base64.b64decode(clean), mime_type="image/png"),
                types.Part.from_text(text=prompt),
            ],
            config={"response_mime_type": "application/json"},
        )

        return jsonify({"result": json.loads(response.text or "{}")})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/modify-plan-vector", methods=["POST"])
@require_auth
def modify_plan_vector():
    """Proxy for plan vector modification."""
    try:
        data = request.json
        prompt = data.get("prompt", "")
        system_instruction = data.get("systemInstruction", "")

        from google.genai import types

        client = get_gemini_client()

        config = {"response_mime_type": "application/json"}
        if system_instruction:
            config["system_instruction"] = system_instruction

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[types.Part.from_text(text=prompt)],
            config=config,
        )

        return jsonify({"result": json.loads(response.text or "{}")})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================
# CONTEXT & MEMORY (UPGRADED MODEL)
# ==============================================

@app.route("/api/summarize-context", methods=["POST"])
@require_auth
def summarize_context():
    """Generate a conversation summary for AI context injection."""
    try:
        data = request.json
        previous_summary = data.get("previousSummary", "")
        new_messages = data.get("newMessages", [])
        user_memory = data.get("userMemory", "")

        prompt = f"""You are a context summarizer for an architectural design AI assistant.

Previous conversation summary: {previous_summary or 'None yet.'}

New messages since last summary:
{chr(10).join([f'- {m["role"]}: {m["text"]}' for m in new_messages if m.get("text")])}

Current user profile memory: {user_memory or 'None yet.'}

Produce an updated summary capturing:
1. The design style being pursued
2. Specific changes the user has requested
3. Current state of the design
4. Any explicit user preferences mentioned

Keep it under 200 words. Be factual and concise."""

        from google.genai import types

        client = get_gemini_client()

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[types.Part.from_text(text=prompt)],
        )

        return jsonify({"summary": response.text or ""})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/update-user-memory", methods=["POST"])
@require_auth
def update_user_memory():
    """Generate an updated user preference memory from conversation summaries."""
    try:
        data = request.json
        current_memory = data.get("currentMemory", "")
        conversation_summaries = data.get("conversationSummaries", [])

        prompt = f"""You are an AI memory manager for an architectural design assistant.

Current user profile memory: {current_memory or 'None yet.'}

Recent conversation summaries:
{chr(10).join([f'- {s}' for s in conversation_summaries])}

Produce an updated user profile memory that captures:
1. Preferred architectural styles
2. Common project types (residential, commercial, etc.)
3. Material and lighting preferences
4. Typical workflow patterns
5. Any recurring requests or preferences

Keep it under 150 words. This will be injected into future conversations as context."""

        from google.genai import types

        client = get_gemini_client()

        response = client.models.generate_content(
            model=FAST_MODEL,
            contents=[types.Part.from_text(text=prompt)],
        )

        return jsonify({"memory": response.text or ""})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================================
# VIDEO GENERATION
# ==============================================

@app.route("/api/generate-video", methods=["POST"])
@require_auth
def generate_video():
    """Proxy for video generation via Veo 3.1 — matches official SDK pattern."""
    import traceback
    import tempfile

    try:
        data = request.json
        image_base64 = data.get("image", "")
        prompt = data.get("prompt", "")

        if not image_base64:
            return jsonify({"error": "No image provided for video generation"}), 400

        from google.genai import types

        client = get_gemini_client()
        clean = image_base64.split(",")[1] if "," in image_base64 else image_base64
        image_bytes = base64.b64decode(clean)
        app.logger.info(f"[generate-video] Image decoded: {len(image_bytes)} bytes")

        # Detect mime type from the data URL prefix
        mime_type = "image/png"
        if image_base64.startswith("data:"):
            detected = image_base64.split(";")[0].split(":")[1]
            if detected:
                mime_type = detected
        app.logger.info(f"[generate-video] Image mime: {mime_type}")

        # Build image using the SDK's Image type
        source_image = types.Image(
            image_bytes=image_bytes,
            mime_type=mime_type,
        )

        video_prompt = (
            "STRICT RULE: Do NOT add, remove, or modify ANY objects, furniture, or elements in the scene. "
            "The video must show EXACTLY what is in the source image — nothing more, nothing less. "
            "Only animate camera movement and natural lighting. "
            f"Smooth cinematic architectural flythrough: {prompt}"
        )

        # Try with configured model, fall back to standard if fast model fails
        models_to_try = [VIDEO_MODEL]
        if "fast" in VIDEO_MODEL:
            models_to_try.append("veo-3.1-generate-preview")

        last_error = None
        for model_name in models_to_try:
            try:
                app.logger.info(f"[generate-video] Starting Veo generation with model: {model_name}")

                operation = client.models.generate_videos(
                    model=model_name,
                    prompt=video_prompt,
                    image=source_image,
                    config=types.GenerateVideosConfig(
                        number_of_videos=1,
                        aspect_ratio="16:9",
                        negative_prompt="cartoon, drawing, low quality, blurry, distorted",
                    ),
                )

                app.logger.info(f"[generate-video] Operation started: {operation.name}")

                # Poll until done
                max_polls = 60
                for i in range(max_polls):
                    if operation.done:
                        break
                    app.logger.info(f"[generate-video] Polling... attempt {i+1}/{max_polls}")
                    time.sleep(10)
                    operation = client.operations.get(operation)

                if not operation.done:
                    app.logger.warning(f"[generate-video] Timed out with model {model_name}")
                    last_error = "Video generation timed out after 10 minutes"
                    continue

                # Check for errors in the operation
                if operation.error:
                    app.logger.warning(f"[generate-video] Operation error: {operation.error}")
                    last_error = f"Video generation failed: {operation.error}"
                    continue

                if not operation.response or not operation.response.generated_videos:
                    rai_msg = ""
                    if operation.response and hasattr(operation.response, 'rai_media_filtered_count'):
                        rai_msg = f" (RAI filtered: {operation.response.rai_media_filtered_count})"
                    app.logger.warning(f"[generate-video] No videos returned{rai_msg}")
                    last_error = f"Video generation completed but no video was returned{rai_msg}"
                    continue

                # SUCCESS — Download the video
                generated_video = operation.response.generated_videos[0]
                video_bytes = None

                # Method 1: Try direct videoBytes access
                if generated_video.video and generated_video.video.video_bytes:
                    video_bytes = generated_video.video.video_bytes
                    app.logger.info(f"[generate-video] Got video via direct bytes: {len(video_bytes)} bytes")

                # Method 2: Download via SDK file API + save to temp
                if not video_bytes:
                    try:
                        client.files.download(file=generated_video.video)
                        tmp_path = tempfile.mktemp(suffix=".mp4")
                        generated_video.video.save(tmp_path)

                        with open(tmp_path, "rb") as f:
                            video_bytes = f.read()

                        try:
                            os.remove(tmp_path)
                        except OSError:
                            pass

                        app.logger.info(f"[generate-video] Got video via file download: {len(video_bytes)} bytes")
                    except Exception as dl_err:
                        app.logger.error(f"[generate-video] File download failed: {dl_err}")
                        last_error = f"Video download failed: {str(dl_err)}"
                        continue

                if not video_bytes:
                    last_error = "Video generated but could not retrieve video data"
                    continue

                video_b64 = base64.b64encode(video_bytes).decode()
                app.logger.info(f"[generate-video] Success! Video size: {len(video_bytes)} bytes, base64 length: {len(video_b64)}")
                return jsonify({"video": f"data:video/mp4;base64,{video_b64}"})

            except Exception as model_err:
                app.logger.warning(f"[generate-video] Model {model_name} failed: {model_err}")
                app.logger.warning(traceback.format_exc())
                last_error = str(model_err)
                continue

        # All models failed
        app.logger.error(f"[generate-video] All models failed. Last error: {last_error}")
        return jsonify({"error": last_error or "Video generation failed with all available models"}), 500

    except Exception as e:
        app.logger.error(f"[generate-video] Unexpected error: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


# OWNER_USER_ID is declared near check_user_budget (above).

@app.route("/api/admin/usage", methods=["GET"])
@require_auth
def admin_usage():
    """Admin-only: return aggregated usage & cost data from Supabase."""
    if request.user_id != OWNER_USER_ID:
        return jsonify({"error": "Forbidden"}), 403

    try:
        import urllib.request as ureq

        # Use the user's own JWT from the request — RLS owner_read_all policy grants access
        auth_header = request.headers.get("Authorization", "")
        user_token = auth_header.split("Bearer ")[1] if "Bearer " in auth_header else SUPABASE_SERVICE_KEY

        headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {user_token}",
            "Content-Type": "application/json",
        }

        def sb_get(path):
            req = ureq.Request(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers)
            with ureq.urlopen(req) as r:
                return json.loads(r.read().decode())

        # All-time totals
        rows = sb_get("usage_logs?select=input_tokens,output_tokens,total_tokens,estimated_cost_usd,model,quality_tier,endpoint,duration_ms,created_at,success&order=created_at.desc&limit=500")

        total_calls   = len(rows)
        total_tokens  = sum(r.get("total_tokens", 0) for r in rows)
        total_cost    = sum(float(r.get("estimated_cost_usd", 0)) for r in rows)
        successful    = sum(1 for r in rows if r.get("success", True))

        # Per-model breakdown
        model_stats = {}
        for r in rows:
            m = r.get("model", "unknown")
            if m not in model_stats:
                model_stats[m] = {"calls": 0, "tokens": 0, "cost": 0.0}
            model_stats[m]["calls"] += 1
            model_stats[m]["tokens"] += r.get("total_tokens", 0)
            model_stats[m]["cost"] += float(r.get("estimated_cost_usd", 0))

        # Daily breakdown (last 30 days) — group by date
        from collections import defaultdict
        daily = defaultdict(lambda: {"calls": 0, "tokens": 0, "cost": 0.0})
        for r in rows:
            day = (r.get("created_at") or "")[:10]
            if day:
                daily[day]["calls"] += 1
                daily[day]["tokens"] += r.get("total_tokens", 0)
                daily[day]["cost"] += float(r.get("estimated_cost_usd", 0))

        # Recent calls
        recent = [{
            "created_at": r.get("created_at"),
            "endpoint":   r.get("endpoint"),
            "model":      r.get("model"),
            "quality_tier": r.get("quality_tier"),
            "total_tokens": r.get("total_tokens", 0),
            "cost":        round(float(r.get("estimated_cost_usd", 0)), 5),
            "duration_ms": r.get("duration_ms"),
            "success":     r.get("success", True),
        } for r in rows[:50]]

        return jsonify({
            "summary": {
                "total_calls": total_calls,
                "total_tokens": total_tokens,
                "total_cost_usd": round(total_cost, 4),
                "successful_calls": successful,
                "avg_cost_per_call": round(total_cost / total_calls, 5) if total_calls else 0,
            },
            "by_model": model_stats,
            "daily": dict(daily),
            "recent": recent,
        })

    except Exception as e:
        app.logger.error(f"[admin/usage] Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":

    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY not set!")
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting Archivision AI Backend on port {port}...")
    print(f"  Image model: {IMAGE_MODEL}")
    print(f"  Fast model:  {FAST_MODEL}")
    print(f"  Video model: {VIDEO_MODEL}")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true")
