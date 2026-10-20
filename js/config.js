// =============================================================
//  Configurare — The Flower Station · Produse Shopify
// =============================================================

// Supabase (Project Settings → API). Cheia publishable e publică prin design;
// datele sunt protejate de login + regulile RLS din supabase/schema.sql.
export const SUPABASE_URL = 'https://yzzmqmyrwzsvlxjdtgpy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Kr0eMx0rxrWP1Lmju1w-oQ_fcc692PE';
export const BUCKET = 'media';

// Poze: versiunea păstrată (latura lungă), miniaturi, pătratul trimis la Shopify
export const MASTER_MAX = 2400;
export const MASTER_JPEG_QUALITY = 0.86;
export const THUMB_MAX = 640;
export const SQUARE_MAX = 2048;

// ---------------- Shopify — modifică aici când schimbi ceva în magazin ----------------
export const SHOPIFY_VENDOR = 'The Flower Station';

// Template-ul paginii de produs, exact cum apare în Shopify la „Theme template”. Se setează automat la publicare.
export const SHOPIFY_TEMPLATE_SUFFIX = 'template-tfs';

// Tipuri de produs (Products → Product organization → Type)
export const SHOPIFY_TYPES = [
  'Buchet flori', 'Aranjamente florale', 'Buchet de mireasă', 'Cadouri', 'Coroane Funerare',
  'Decorare Cristelniță', 'Lumânare Botez', 'Lumânare Nuntă', 'Plante',
];

// Colecții (Products → Collections). Importul CSV permite una singură pe produs.
export const SHOPIFY_COLLECTIONS = [
  'Buchete flori', 'Aranjamente florale', 'Buchet Mireasă', 'Cadouri', 'Plante', 'Coroane Funerare', 'Coronițe',
  'Ziua Mamei', 'Ziua iubitei', "Valentine's Day", 'Aniversare', 'Primăvara mea', 'Back to school',
  'Evenimente', 'Lumânare Botez', 'Lumânare Nuntă', 'Decorare Cristelniță', 'Best selling', 'Abonamente', 'Home page',
];

// Paragrafele adăugate automat după primul paragraf al descrierii
export const SHOPIFY_DESC_FOOTER = [
  'Buchetele noastre sunt livrate proaspete și sunt protejate de un ambalaj elegant și de calitate, conceput să le păstreze prospețimea și frumusețea pe tot parcursul transportului.',
  'Ne dedicăm satisfacției clienților noștri, așadar nu ezita să ne contactezi la numărul afișat pentru a găsi varianta care să se potrivească cel mai bine nevoilor tale.',
  'Produs perisabil – nu se returnează.',
];

// Variantele propuse când bifezi „Are variante”
export const DEFAULT_VARIANTS = ['S', 'M', 'L'];
