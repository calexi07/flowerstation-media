// =============================================================
//  Configurare — completează cu datele proiectului tău Supabase
//  Supabase → Project Settings → API (sau "Connect")
//  Cheia "anon/publishable" este publică prin design; securitatea
//  e asigurată de politicile RLS din supabase/schema.sql.
// =============================================================
export const SUPABASE_URL = 'https://yzzmqmyrwzsvlxjdtgpy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Kr0eMx0rxrWP1Lmju1w-oQ_fcc692PE';

export const BUCKET = 'media';

// Versiunea "master" (cea cu link public) — latura lungă maximă, în pixeli
export const MASTER_MAX = 2400;
export const MASTER_JPEG_QUALITY = 0.86;
// Miniaturi pentru grilă
export const THUMB_MAX = 640;

// Limita planului Supabase (pentru indicatorul de spațiu din sidebar)
export const STORAGE_QUOTA_BYTES = 1 * 1024 ** 3; // 1 GB (Free). Pe Pro: 100 GB

// Formate de export la download (crop după punctul de focus)
export const EXPORT_FORMATS = [
  { id: 'web',     label: 'Web',               hint: 'max. 1600 px, JPG',  fit: 'contain', w: 1600, h: 1600 },
  { id: 'square',  label: 'Instagram pătrat',  hint: '1080 × 1080',        fit: 'cover',   w: 1080, h: 1080 },
  { id: 'portrait',label: 'Instagram portret', hint: '1080 × 1350',        fit: 'cover',   w: 1080, h: 1350 },
  { id: 'story',   label: 'Story / Reels',     hint: '1080 × 1920',        fit: 'cover',   w: 1080, h: 1920 },
  { id: 'og',      label: 'Facebook / link',   hint: '1200 × 630',         fit: 'cover',   w: 1200, h: 630  },
  { id: 'banner',  label: 'Banner site',       hint: '1920 × 800',         fit: 'cover',   w: 1920, h: 800  },
];
