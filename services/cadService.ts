
import { FloorPlan, Wall, Door, WindowEntity, Point2D } from "../types";

// --- MOCK DATA FOR SIMULATION ---
// Since we cannot run a real backend to convert DWG to JSON in this environment,
// we provide a complex mock plan when a user uploads a .DWG file to demonstrate the UI capabilities.
export const MOCK_FLOOR_PLAN: FloorPlan = {
  meta: { filename: "demo_apartment.dwg", scale: 100 },
  walls: [
    { id: "w1", start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, thickness: 0.2, layer: "A-WALL" },
    { id: "w2", start: { x: 0, y: 10 }, end: { x: 15, y: 10 }, thickness: 0.2, layer: "A-WALL" },
    { id: "w3", start: { x: 15, y: 10 }, end: { x: 15, y: 0 }, thickness: 0.2, layer: "A-WALL" },
    { id: "w4", start: { x: 15, y: 0 }, end: { x: 0, y: 0 }, thickness: 0.2, layer: "A-WALL" },
    // Interior walls
    { id: "w5", start: { x: 0, y: 4 }, end: { x: 8, y: 4 }, thickness: 0.15, layer: "A-WALL-INT" },
    { id: "w6", start: { x: 8, y: 4 }, end: { x: 8, y: 0 }, thickness: 0.15, layer: "A-WALL-INT" },
    { id: "w7", start: { x: 8, y: 4 }, end: { x: 8, y: 10 }, thickness: 0.15, layer: "A-WALL-INT" },
  ],
  doors: [
    { id: "d1", position: { x: 4, y: 4 }, width: 0.9, rotation: 0, layer: "A-DOOR" },
    { id: "d2", position: { x: 8, y: 2 }, width: 0.8, rotation: 90, layer: "A-DOOR" },
    { id: "d3", position: { x: 2, y: 0 }, width: 1.0, rotation: 0, layer: "A-DOOR-EXT" } // Entrance
  ],
  windows: [
    { id: "win1", position: { x: 4, y: 10 }, width: 2.0, rotation: 0, layer: "A-GLAZ" },
    { id: "win2", position: { x: 12, y: 10 }, width: 2.0, rotation: 0, layer: "A-GLAZ" }
  ],
  annotations: []
};

// Heuristic keywords to identify layers
const LAYERS = {
  WALL: ['WALL', 'MURO', 'PARED', 'A-WALL', 'EXTERIOR', 'INTERIOR', 'ESTRUCTURA'],
  DOOR: ['DOOR', 'PUERTA', 'A-DOOR', 'OPENING'],
  WINDOW: ['WINDOW', 'VENTANA', 'A-GLAZ', 'GLASS', 'VIDRIO'],
  TEXT: ['TEXT', 'ANNO', 'DIM', 'COTAS', 'ROOM', 'TAG']
};

/**
 * Parses raw DXF entities into a Semantic FloorPlan
 */
export const parseRawEntitiesToFloorPlan = (entities: any[], filename: string): FloorPlan => {
  const plan: FloorPlan = {
    walls: [],
    doors: [],
    windows: [],
    annotations: [],
    meta: { filename, scale: 1.0 }
  };

  let idCounter = 0;
  const genId = (prefix: string) => `${prefix}_${++idCounter}`;

  const isLayer = (layerName: string, keywords: string[]) => {
    if (!layerName) return false;
    const upper = layerName.toUpperCase();
    return keywords.some(k => upper.includes(k));
  };

  entities.forEach(e => {
    // 1. WALLS (Lines & Polylines)
    if (e.type === 'LINE' || e.type === 'LWPOLYLINE') {
      // Basic heuristic: if it's on a wall layer OR not on other specific layers
      if (isLayer(e.layer, LAYERS.WALL) || (!isLayer(e.layer, LAYERS.DOOR) && !isLayer(e.layer, LAYERS.WINDOW) && !isLayer(e.layer, LAYERS.TEXT))) {
        const segments = extractSegments(e);
        segments.forEach(seg => {
           plan.walls.push({
             id: genId('wall'),
             start: seg.start,
             end: seg.end,
             thickness: 0.15, 
             layer: e.layer || '0'
           });
        });
      }
    }

    // 2. DOORS
    if (isLayer(e.layer, LAYERS.DOOR)) {
       if (e.type === 'INSERT') {
          plan.doors.push({
            id: genId('door'),
            position: { x: e.position?.x || 0, y: e.position?.y || 0 },
            width: (e.scale?.x || 1) * 0.9,
            rotation: e.rotation || 0,
            layer: e.layer
          });
       }
    }

    // 3. WINDOWS
    if (isLayer(e.layer, LAYERS.WINDOW)) {
       if (e.type === 'INSERT' || e.type === 'LINE') {
           const pos = e.type === 'INSERT' ? e.position : (e.vertices ? e.vertices[0] : {x:0,y:0});
           plan.windows.push({
               id: genId('win'),
               position: { x: pos.x, y: pos.y },
               width: 1.2,
               rotation: 0,
               layer: e.layer
           });
       }
    }
  });

  return plan;
};

const extractSegments = (entity: any): {start: Point2D, end: Point2D}[] => {
    const segments: {start: Point2D, end: Point2D}[] = [];
    if (entity.type === 'LINE') {
        segments.push({ 
            start: { x: entity.vertices[0].x, y: entity.vertices[0].y }, 
            end: { x: entity.vertices[1].x, y: entity.vertices[1].y } 
        });
    } else if (entity.type === 'LWPOLYLINE' && entity.vertices.length > 1) {
        for (let i = 0; i < entity.vertices.length - 1; i++) {
            segments.push({
                start: { x: entity.vertices[i].x, y: entity.vertices[i].y },
                end: { x: entity.vertices[i+1].x, y: entity.vertices[i+1].y }
            });
        }
        if (entity.closed) {
            segments.push({
                start: { x: entity.vertices[entity.vertices.length-1].x, y: entity.vertices[entity.vertices.length-1].y },
                end: { x: entity.vertices[0].x, y: entity.vertices[0].y }
            });
        }
    }
    return segments;
};

// HELPER: Get bounds of a plan
export const getPlanBounds = (plan: FloorPlan) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const update = (p: Point2D) => {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    };
    plan.walls.forEach(w => { update(w.start); update(w.end); });
    plan.doors.forEach(d => update(d.position));
    plan.windows.forEach(w => update(w.position));
    
    if (!isFinite(minX)) return { minX: -10, minY: -10, maxX: 10, maxY: 10, width: 20, height: 20 };
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

/**
 * Draws the vector plan onto a context with a specific transform (pan/zoom)
 * Used by the interactive viewer.
 */
export const drawVectorPlan = (
    ctx: CanvasRenderingContext2D, 
    plan: FloorPlan, 
    transform: { x: number, y: number, scale: number },
    canvasWidth: number,
    canvasHeight: number
) => {
    // 1. Setup Coordinate System
    // We want to center the plan initially, but respect the transform (pan/zoom)
    // The transform passed in assumes screen coordinates.
    
    // Helper: World to Screen
    const toScreenX = (wx: number) => transform.x + (wx * transform.scale);
    // Flip Y for standard CAD view (Y up) vs Screen (Y down), or keep consistent. 
    // Usually CAD is Y-Up. Let's assume input data is Y-Up.
    // To simplify: let's map input Y directly to screen Y but inverted if needed. 
    // For this demo, let's keep 1:1 orientation to avoid confusion, assuming data is screen-space oriented or normalized.
    // If data is "real world" (y up), we might need `transform.y - (wy * scale)`.
    // Let's use standard canvas coords (y down) for simplicity unless data implies otherwise.
    const toScreenY = (wy: number) => transform.y + (wy * transform.scale);

    const scaledThickness = Math.max(1, 0.2 * transform.scale);

    // 2. Draw Walls
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    plan.walls.forEach(w => {
        const x1 = toScreenX(w.start.x);
        const y1 = toScreenY(w.start.y);
        const x2 = toScreenX(w.end.x);
        const y2 = toScreenY(w.end.y);

        // Wall Core (Gray)
        ctx.beginPath();
        ctx.strokeStyle = '#94a3b8'; // Slate 400
        ctx.lineWidth = scaledThickness;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Wall Outline (White)
        ctx.beginPath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1; 
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        
        // Vertices
        ctx.fillStyle = '#ffffff';
        const nodeSize = Math.max(2, 3 * (transform.scale / 50)); // Adaptive size
        ctx.beginPath(); ctx.arc(x1, y1, nodeSize, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, nodeSize, 0, Math.PI*2); ctx.fill();
    });

    // 3. Draw Doors (Cyan)
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = Math.max(1, 1 * (transform.scale / 40));
    plan.doors.forEach(d => {
        const x = toScreenX(d.position.x);
        const y = toScreenY(d.position.y);
        const r = d.width * transform.scale;
        
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI/2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + r); // Simple representation
        ctx.stroke();
    });
    
    // 4. Draw Windows (Blue)
    ctx.strokeStyle = '#3b82f6';
    plan.windows.forEach(w => {
        const x = toScreenX(w.position.x);
        const y = toScreenY(w.position.y);
        const len = (w.width * transform.scale) / 2;
        
        // Simple box
        ctx.strokeRect(x - len, y - 5, len * 2, 10);
    });
};

/**
 * Apply AI Operations to the Plan
 */
export const applyPlanOperations = (plan: FloorPlan, operations: any[]): FloorPlan => {
    // Deep copy
    const newPlan = JSON.parse(JSON.stringify(plan)) as FloorPlan;

    operations.forEach(op => {
        try {
            if (op.action === 'add_wall') {
                newPlan.walls.push({
                    id: `wall_ai_${Date.now()}_${Math.random()}`,
                    start: op.params.start,
                    end: op.params.end,
                    thickness: op.params.thickness || 0.15,
                    layer: 'A-WALL-NEW'
                });
            } else if (op.action === 'move') {
                 // Simplistic move logic for demo
                 const targetId = op.params.element_id;
                 const dx = op.params.dx || 0;
                 const dy = op.params.dy || 0;
                 
                 const wall = newPlan.walls.find(w => w.id === targetId);
                 if (wall) {
                     wall.start.x += dx; wall.start.y += dy;
                     wall.end.x += dx; wall.end.y += dy;
                 }
            } else if (op.action === 'add_door') {
                newPlan.doors.push({
                    id: `door_ai_${Date.now()}`,
                    position: op.params.position,
                    width: op.params.width || 0.9,
                    rotation: 0,
                    layer: 'A-DOOR-NEW'
                });
            }
        } catch (e) {
            console.error("Failed to apply op", op, e);
        }
    });

    return newPlan;
};

/**
 * Static Render for Image Generation (Context export)
 */
export const renderPlanToCanvas = (plan: FloorPlan, canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Auto-fit logic
    const bounds = getPlanBounds(plan);
    const padding = Math.max(bounds.width, bounds.height) * 0.1;
    const scale = Math.min(canvas.width / (bounds.width + padding * 2), canvas.height / (bounds.height + padding * 2));
    
    // Center it
    const tx = (canvas.width - (bounds.width * scale)) / 2 - (bounds.minX * scale);
    const ty = (canvas.height - (bounds.height * scale)) / 2 - (bounds.minY * scale);
    
    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawVectorPlan(ctx, plan, { x: tx, y: ty, scale }, canvas.width, canvas.height);
};

export const exportPlanToDxf = (plan: FloorPlan): string => {
    let s = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`;
    plan.walls.forEach(w => {
        s += `0\nLINE\n8\n${w.layer}\n10\n${w.start.x}\n20\n${w.start.y}\n11\n${w.end.x}\n21\n${w.end.y}\n`;
    });
    s += `0\nENDSEC\n0\nEOF`;
    return s;
};
