// The final tomato artwork has one shared identity across every screen and icon.
// Change the version when replacing the master artwork to invalidate old browser caches.
export const brandVersion = "08786b3988a2";
export const brandAssets = {
  logo: `/jiawenlex-icon.png?v=${brandVersion}`,
  favicon: `/favicon-32.png?v=${brandVersion}`,
  icon: `/favicon-192.png?v=${brandVersion}`,
  apple: `/apple-touch-icon.png?v=${brandVersion}`,
} as const;
