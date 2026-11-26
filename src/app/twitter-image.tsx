// Same card for the X/Twitter preview — the file convention makes twitter:image
// explicit instead of relying on the og:image fallback, and layout.tsx can now
// honestly declare card:"summary_large_image" (a real 1200x630 asset exists).
export { default, alt, size, contentType } from "./opengraph-image";
