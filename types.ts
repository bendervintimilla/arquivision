
export interface DesignPreset {
  id: string;
  label: string;
  promptSuffix: string;
  icon: string;
  color?: string;
}

export enum AppState {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  READY = 'READY',
  GENERATING = 'GENERATING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface RenderAsset {
  id: string;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  source: 'PHOTO' | 'PLAN' | 'VIDEO';
  prompt: string;
  timestamp: number;
}

export interface DesignStep {
  id: string;
  role: 'user' | 'model';
  text?: string;
  images?: string[]; // Array of base64 images (variations)
  selectedImageIndex?: number; // Which image the user picked to continue from
  isMaskEdit?: boolean; // Was this step created using a mask?
  floorPlanData?: FloorPlan; // If this step has vector data
}

export interface GenerationResult {
  originalImage: string;
  generatedImage: string;
  prompt: string;
}

// Phase 2 Types
export interface Point2D {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  layer: string;
}

export interface Door {
  id: string;
  position: Point2D;
  width: number;
  rotation: number;
  layer: string;
}

export interface WindowEntity {
  id: string;
  position: Point2D;
  width: number;
  rotation: number;
  layer: string;
}

export interface FloorPlan {
  walls: Wall[];
  doors: Door[];
  windows: WindowEntity[];
  annotations: any[];
  meta: {
    filename: string;
    scale: number;
  };
}

export interface Room {
  id: string;
  type: string;
  estimatedArea?: string;
  dimensions?: string;
  features: string[];
  adjacentTo?: string[];
}

export interface PlanAnalysis {
  rooms: Room[];
  doors?: any[];
  windows?: any[];
  notes?: string;
}

export interface PlanImprovementStep {
  id: string;
  type: 'analysis' | 'user_prompt' | 'ai_generation';
  content?: string; // For text
  image?: string; // For generated plans/renders
  metadata?: any; // For audit data
  timestamp: number;
}

// --- Edit Intelligence Engine Types ---

export type EditMode = 'EDIT' | 'GENERATE' | 'STYLE_TRANSFER' | 'REMOVE_OBJECTS';

export interface EditIntent {
  mode: EditMode;
  preserveLayout: boolean;
  preserveLighting: boolean;
  preservePerspective: boolean;
  elementsToChange: string[];
  elementsToKeep: string[];
  targetStyle?: string;
  confidence: number;
}

export interface SceneAnalysis {
  description: string;
  objects: string[];
  architecture: string;
  cameraAngle: string;
  lighting: string;
  colorPalette: string[];
  spatialLayout: string;
}

export type PageRole = 'PHOTO' | 'PLAN' | 'VIDEO';

export interface EditContextPreferences {
  mode: EditMode;
  preserveLayout: boolean;
  preserveLighting: boolean;
  preservePerspective: boolean;
  rememberPreference: boolean;
}

export interface CreativeDatapoint {
  inputSceneAnalysis: SceneAnalysis | null;
  userCommand: string;
  detectedIntent: EditIntent | null;
  promptSent: string;
  modelUsed: string;
  userAccepted: boolean;
  pageSource: PageRole;
  styleTags: string[];
  objectTags: string[];
}
