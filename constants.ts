import { DesignPreset } from './types';

// Model IDs are owned by services/modelConfig.ts — re-exported here for
// backwards compatibility. Do NOT add new model strings to this file;
// edit services/modelConfig.ts instead.
export {
  MODEL_NAME,
  PRO_MODEL_NAME,
  FAST_IMAGE_MODEL_NAME,
  FAST_MODEL_NAME,
} from './services/modelConfig';

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: 'british-georgian',
    label: 'British Georgian',
    promptSuffix: 'Design in British Georgian style. Classical symmetry, high ceilings, sash windows, pale color palette (sage green, wedgewood blue), decorative cornices, elegant proportions, spacious and airy.',
    icon: '🏛️'
  },
  {
    id: 'british-victorian',
    label: 'British Victorian',
    promptSuffix: 'Apply British Victorian interior style. Rich dark colors (ruby, emerald), mahogany furniture, ornate fireplace, patterned tiles or rugs, velvet textiles, clutter of decorative objects, bay windows.',
    icon: '🎩'
  },
  {
    id: 'british-regency',
    label: 'British Regency',
    promptSuffix: 'Design in British Regency style. Neoclassical elegance, stripes, sabre-leg furniture, crystal chandeliers, light pastel tones, gold accents, sophisticated and refined.',
    icon: '🪞'
  },
  {
    id: 'british-country',
    label: 'British Country',
    promptSuffix: 'Transform into British Country Cottage style. Exposed timber beams, stone floors, floral chintz fabrics, cozy fireplace, rustic wood furniture, warm lighting, lived-in and comfortable atmosphere.',
    icon: '🏡'
  },
  {
    id: 'british-edwardian',
    label: 'British Edwardian',
    promptSuffix: 'Design in British Edwardian style. Lighter and less cluttered than Victorian, floral patterns, pastel colors, wicker furniture, stained glass, fresh and airy feel.',
    icon: '🫖'
  },
  {
    id: 'modern-minimalist',
    label: 'Modern Minimalist',
    promptSuffix: 'Redesign this interior in a modern minimalist style. Use clean lines, neutral color palette, natural light, and uncluttered spaces. High quality photorealistic render.',
    icon: '✨'
  },
  {
    id: 'industrial-chic',
    label: 'Industrial Chic',
    promptSuffix: 'Apply an industrial chic style. Exposed brick, metal accents, raw wood textures, open layout, dramatic lighting. Photorealistic rendering.',
    icon: '🏭'
  },
  {
    id: 'scandinavian',
    label: 'Scandinavian',
    promptSuffix: 'Transform into Scandinavian design. Hygge atmosphere, light woods, white walls, cozy textiles, functional furniture, bright and airy.',
    icon: '❄️'
  },
  {
    id: 'mid-century',
    label: 'Mid-Century Modern',
    promptSuffix: 'Redesign in Mid-Century Modern style. Organic curves, teak wood, retro colors like mustard and teal, statement lighting.',
    icon: '🛋️'
  },
  {
    id: 'luxury-classic',
    label: 'Luxury Classic',
    promptSuffix: 'Create a Luxury Classic interior. Crown molding, velvet furniture, gold accents, crystal chandeliers, marble floors, elegant and timeless.',
    icon: '👑'
  }
];

export const PHASE2_STYLE_PRESETS: DesignPreset[] = [
  { id: 'modern-minimal', label: 'Modern Minimalist', icon: '⬜', color: '#E5E5E5', promptSuffix: '' },
  { id: 'scandi', label: 'Scandinavian', icon: '🌲', color: '#D4A574', promptSuffix: '' },
  { id: 'industrial', label: 'Industrial Loft', icon: '🏭', color: '#8B7355', promptSuffix: '' },
  { id: 'luxury', label: 'Luxury Contemporary', icon: '💎', color: '#C9A962', promptSuffix: '' },
  { id: 'mediterranean', label: 'Mediterranean', icon: '🏺', color: '#CD853F', promptSuffix: '' },
  { id: 'japanese', label: 'Japanese Zen', icon: '🎋', color: '#90A955', promptSuffix: '' },
  { id: 'artdeco', label: 'Art Deco', icon: '✨', color: '#FFD700', promptSuffix: '' },
  { id: 'coastal', label: 'Coastal Fresh', icon: '🌊', color: '#87CEEB', promptSuffix: '' },
  { id: 'midcentury', label: 'Mid-Century', icon: '🛋️', color: '#DAA520', promptSuffix: '' },
  { id: 'boho', label: 'Bohemian', icon: '🌸', color: '#C71585', promptSuffix: '' },
];

export const VIEW_ANGLE_PRESETS = [
  { id: 'WIDE_ENTRY', label: 'Wide Entry Shot', icon: '📷' },
  { id: 'CORNER_HERO', label: 'Hero Corner', icon: '🎬' },
  { id: 'WINDOW_FACING', label: 'Window View', icon: '☀️' },
  { id: 'DETAIL_VIGNETTE', label: 'Detail Vignette', icon: '🔍' },
];
