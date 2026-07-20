// Single source of truth for the homepage hero-graphic variants (KB-0008 —
// one canonical list; every other place points here so the allowlist can't
// drift). Imported by: the public+editor renderer (HeroGraphic.astro), the
// astro:content read schema (content.config.ts), the editor write/trust
// boundary (schemas.ts), and the editor switcher UI (EditHome.astro).
//
// Dependency-free so it's safe to import from server code, browser scripts,
// AND the content-collection config.
export const HERO_VARIANTS = ['radar', 'rotation', 'synthesis', 'orbit'] as const;

export type HeroVariant = (typeof HERO_VARIANTS)[number];

export const DEFAULT_HERO_VARIANT: HeroVariant = 'synthesis';

export function isHeroVariant(v: unknown): v is HeroVariant {
  return typeof v === 'string' && (HERO_VARIANTS as readonly string[]).includes(v);
}
