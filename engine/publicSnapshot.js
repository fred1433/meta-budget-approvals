// REAL public facts, each with its source and collection time. Nothing else on the page is real.
export const SNAPSHOT = {
  adLibrary: {
    source: 'Meta Ad Library, page "Katia Designs" (page_id 167345800625919), active ads, United States',
    url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=167345800625919',
    collected_utc: '2026-11-03T12:47:00Z',
    startedOct30: 6, startedNov1: 7,
  },
  ads: {
    '2054044151911791': { headline: 'FINALLY HERE: THE LIMITED-EDITION CRYSTAL CROSS', opening: 'THE WAIT IS OVER.', started: '2026-10-14', format: 'image', destination: 'katiadesigns.com/products/crystal-cross-chunky-chain-layering-necklace', img: 'img/crystal-cross.jpg', alt: 'Two crystal cross pendants engraved LOVE and TRUST on silver and gold chunky chains' },
    '941661894938227': { headline: 'BOGO Boho Wraps! Buy one, get one FREE.', opening: 'Wear one. Gift one. Or keep them both', started: '2026-08-26', format: 'video, 0:45', destination: 'katiadesigns.com/collections/boho-wrap', img: 'img/bogo-boho.jpg', alt: 'Video still: a woman in denim wearing a boho wrap, captioned bracelet today, necklace tomorrow' },
    '1655236699580259': { headline: 'Wear Your Inner Light', opening: 'More than jewelry, it’s a daily reminder to stay grounded', started: '2026-10-18', format: 'video, 1:34', destination: 'try.katiadesigns.com/remember-who-the-f-you-are', img: 'img/inner-light.jpg', alt: 'Video still: a woman in denim layering necklaces, a small dog beside her' },
  },
  catalog: {
    source: 'katiadesigns.com/collections/boho-wrap/products.json (public storefront feed)',
    collected_utc: '2026-11-03T12:49:53Z',
    bohoWrap: { products: 16, variants: 62, unavailableVariants: 20, fullyUnavailable: ['Believe Heart Crystal Boho Wrap Bracelet/Necklace'] },
    crystalCross: { price_cents: 12400, variantsAvailable: 2, variants: 2 },
    note: 'The feed gives available yes or no per variant, not quantities.',
  },
  meta: {
    budgetFlex: { text: 'On days when better advertising opportunities are available, Meta may spend up to 75% over your daily budget.', url: 'https://www.facebook.com/business/help/190490051321426' },
    attribution2026: { text: 'Since March 2026, click-through counts link clicks only; shares, saves and other engagements moved to engage-through attribution.', url: 'https://about.fb.com/ltam/news/2026/03/simplificando-la-medicion-de-anuncios-para-un-mundo-social-first/' },
    viewWindows: { text: '7-day and 28-day view windows are no longer returned by the Ads Insights API since January 12, 2026.' },
  },
};
