# ArquiVision AI — Presentation Day Guide

15 minutes total, strictly enforced: **~9 min pitch + ~4 min live demo + ~2 min Q&A**.
All three members speak (rubric requirement).

---

> **Easiest path: demo on the live site — https://bednrixvision.ai** — already deployed,
> no local setup needed. Just sign in beforehand. Keep the local setup below as a backup.

## 0. Pre-demo checklist (do this 30 min before)

- [ ] `backend/.env` filled: `GEMINI_API_KEY`, `SUPABASE_*`, and `OPENAI_API_KEY` if showing HD/Ultra.
- [ ] Backend up: `cd backend && source venv/bin/activate && python main.py` → check `http://localhost:5000/api/health` returns `"status":"ok"` and `"has_key":true`.
- [ ] Frontend up: `npm run dev` → open `http://localhost:5173`, already **signed in**.
- [ ] **Pre-load a fallback.** Generations can take 15–25s on HD. Have one render *already done* on screen, and a Draft-tier (Gemini Flash, sub-3s) ready as the live one so the demo never stalls.
- [ ] Sample assets ready on the desktop: one **room photo** (living room), one **floor plan** (PNG), one finished render for the **video** step.
- [ ] Wifi tested. If venue wifi is unreliable, tether to a phone. The demo is 100% network-dependent.
- [ ] Browser zoom set so the audience can read the UI. Close other tabs/notifications.
- [ ] Admin Dashboard tab open in a second browser tab (for the "we measure cost" beat).

**Demo safety rule:** if a live generation fails, don't fight it — switch to the
pre-loaded result and say "here's one we ran earlier at Ultra quality." Never let
dead air or a spinner eat your time budget.

---

## 1. Run of show (who says what)

### Speaker 1 — Problem & value (~3 min)
1. **Hook (Slide: Problem).** "A single photoreal render costs a studio €150–€600 and takes 2–5 days. The client wants to *see* the change while they're still in the room."
2. **Value prop (Slide: Solution).** Days → seconds, hundreds of euros → cents. Close the design decision in the first meeting.
3. **Market (Slide: Who).** Architecture & interior-design studios; secondary: real-estate virtual staging.
4. Hand off: "…and the way we do it is more than an API call — over to [Speaker 2]."

### Speaker 2 — Technical depth (~3.5 min)
5. **The moat (Slide: Architecture).** Spanish architectural vocabulary engine (cornisa, moldura, cuarterón…), the 3-call pipeline (classify intent → analyze scene → generate), quality tiers, provider fallback.
6. **Why a backend proxy (Slide: Architecture).** Keys server-side, JWT on every call, spend cap, one-file model swap.
7. **Models & evaluation (Slide: Tech).** gpt-image-2 for hero tiers, Gemini Flash for drafts/fallback, Veo 3.1 for video; cost logged per call; daily per-user cap as a guardrail.
8. Hand off to the live demo: "Let me show you it actually working — [Speaker 3] is driving."

### Speaker 3 — Live demo (~4 min) + close
Drive the app (see §2). Then close with the **business value recap** and the
**roadmap** slide. End *before* the 15-minute mark with time for Q&A.

### Q&A (~2 min) — all three field questions.

---

## 2. Live demo script (~4 min, in order)

1. **Photo Enhancer (the core, ~2 min).**
   - Upload the living-room photo. Point out scene analysis is reading camera + lighting.
   - Type a Spanish instruction: *"dale un estilo escandinavo, manteniendo la cámara y la luz."* Generate at **Draft** (fast) so it returns live.
   - When it returns, type a surgical edit: *"molduras que rodeen la TV"* — call out that the intent classifier detected a *framing* request and a *precision edit*.
   - Optional: show the **A/B Lab** — same prompt through GPT-Image vs Gemini side by side.

2. **Plan → Render (~1 min).**
   - Upload the floor-plan PNG. Generate a furnished photoreal render. One line: "from a 2D plan to a sellable visual, no 3D artist."

3. **Video Studio (~30s).**
   - Take the finished render → generate a short fly-through (or show the pre-rendered one — Veo takes minutes, so **use the pre-rendered clip live**).

4. **Admin Dashboard (~30s).**
   - Flip to the dashboard: "every generation is logged — model, latency, and cost. This is how we keep a power user from running up the bill, and how we'd price the product."

---

## 3. Likely Q&A — have answers ready

- **"How is this different from ChatGPT/Midjourney?"** The vocabulary engine + preserve-camera/lighting pipeline + plan-to-render + cost governance. A generic tool redesigns; we *edit the client's actual space* in studio language.
- **"What does it cost to run?"** Draft ≈ $0.005, HD ≈ $0.12–0.25 per image; daily per-user cap stops runaway spend. All logged in `usage_logs`.
- **"What's the biggest technical risk?"** Geometry drift on plan→render — the model can move walls. Roadmap fix: Flux + ControlNet for locked geometry.
- **"Does it handle 3D rotations of furniture?"** Hard for image-to-image; we detect these (REARRANGE mode) and either warn or regenerate the layout, and accept multi-view input to resolve hidden sides.
- **"Is it production-ready?"** It's a working MVP with auth, storage, telemetry and a spend cap; the roadmap (`.agents/`) lists what hardens it for scale.

---

## 4. What was verified in this repo

- Backend modules compile cleanly (`python -m py_compile main.py models_config.py openai_client.py`).
- All frontend entry files present; deps declared in `package.json` / `backend/requirements.txt`.
- CORS is restricted to `ALLOWED_ORIGINS` (not open to `*`); `__pycache__` and `.env` are git-ignored.
- A real, professional `README.md` is in place for the graders.

> Not verified here (requires live keys + Supabase): an end-to-end generation
> round-trip. Do a full dry run on the venue setup using §0 before presenting.
