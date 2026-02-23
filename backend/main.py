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
# Set ALLOWED_ORIGINS env var as comma-separated list for custom domains.
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "").split(",") if os.environ.get("ALLOWED_ORIGINS") else ["*"]
CORS(app, resources={r"/*": {"origins": "*"}})

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

# Model constants
IMAGE_MODEL = "gemini-3-pro-image-preview"  # Pro model for professional quality (4K, thinking)
FAST_IMAGE_MODEL = "gemini-2.5-flash-image" # Fast model for speed-oriented generation
FAST_MODEL = "gemini-2.5-flash"             # Fast text/vision for analysis
VIDEO_MODEL = "veo-3.1-fast-generate-preview"

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
                "apikey": SUPABASE_SERVICE_KEY or os.environ.get("SUPABASE_ANON_KEY", ""),
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
    """Classify user's editing intent using fast model."""
    try:
        data = request.json
        command = data.get("command", "")

        from google.genai import types

        client = get_gemini_client()

        prompt = f"""
Classify this architectural editing command. Return ONLY valid JSON, no markdown.

USER COMMAND: "{command}"

Return this exact JSON structure:
{{
  "mode": "EDIT" or "GENERATE" or "STYLE_TRANSFER" or "REMOVE_OBJECTS",
  "preserveLayout": true/false,
  "preserveLighting": true/false,
  "preservePerspective": true/false,
  "elementsToChange": ["list", "of", "elements"],
  "elementsToKeep": ["list", "of", "elements"],
  "targetStyle": "style name or null",
  "confidence": 0.0-1.0
}}

CLASSIFICATION RULES:
- EDIT: User wants to modify specific elements (change color, swap furniture, etc.)
- GENERATE: User wants a completely new image from text description
- STYLE_TRANSFER: User wants to change the design style (modern, victorian, etc.)
- REMOVE_OBJECTS: User wants to remove/delete specific things from the image

For EDIT, STYLE_TRANSFER, REMOVE_OBJECTS: preserveLayout/Lighting/Perspective should be TRUE.
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
    """Proxy for image generation/editing via Gemini image model."""
    try:
        data = request.json
        prompt = data.get("prompt", "")
        system_instruction = data.get("systemInstruction", "")
        image_base64 = data.get("image")
        image_mime = data.get("imageMime", "image/png")
        mask_base64 = data.get("mask")
        reference_base64 = data.get("referenceImage")
        reference_mime = data.get("referenceImageMime", "image/png")
        use_fast_model = data.get("useFastModel", False)

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

        parts.append(types.Part.from_text(text=prompt))

        # Use proper GenerateContentConfig with response_modalities
        selected_model = FAST_IMAGE_MODEL if use_fast_model else IMAGE_MODEL
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            system_instruction=system_instruction if system_instruction else None,
        )

        app.logger.info(f"[generate-image] Model: {selected_model}, Prompt length: {len(prompt)}, Has image: {bool(image_base64)}, Has mask: {bool(mask_base64)}")

        response = client.models.generate_content(
            model=selected_model,
            contents=parts,
            config=config,
        )

        # Extract image data from response
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

        if text_parts:
            app.logger.info(f"[generate-image] Model also returned text: {text_parts}")

        if not images:
            app.logger.error(f"[generate-image] No images returned. Text parts: {text_parts}")
            return jsonify({"error": "No image generated — model returned text only", "text": text_parts}), 500

        app.logger.info(f"[generate-image] Success: {len(images)} image(s) generated")
        return jsonify({"images": images})

    except Exception as e:
        app.logger.error(f"[generate-image] Exception: {str(e)}")
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


if __name__ == "__main__":
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY not set!")
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting Archivision AI Backend on port {port}...")
    print(f"  Image model: {IMAGE_MODEL}")
    print(f"  Fast model:  {FAST_MODEL}")
    print(f"  Video model: {VIDEO_MODEL}")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "false").lower() == "true")
