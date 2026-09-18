/** Source flask PNG — scale/center only, do not redraw. */

export const INK = "#0a0b0a";
export const CREAM = "#d7dbd4";
export const LOGO_HREF = "/potion-logo.png";
export const LOGO_W = 268;
export const LOGO_H = 301;
/** Padding around the flask inside the 32×32 tile (contain + center). */
export const LOGO_PAD = 0.14;

export function logoPlacement(size = 32, pad = LOGO_PAD) {
  const avail = size * (1 - pad * 2);
  const s = Math.min(avail / LOGO_W, avail / LOGO_H);
  const w = LOGO_W * s;
  const h = LOGO_H * s;
  return {
    x: +((size - w) / 2).toFixed(3),
    y: +((size - h) / 2).toFixed(3),
    w: +w.toFixed(3),
    h: +h.toFixed(3),
  };
}

export function markSvg({
  size = 32,
  rounded = false,
  flask = CREAM,
  background = INK,
  pad = 0,
  maskHref = LOGO_HREF,
} = {}) {
  const tileSize = 32;
  const vb = pad
    ? `${-pad} ${-pad} ${tileSize + pad * 2} ${tileSize + pad * 2}`
    : `0 0 ${tileSize} ${tileSize}`;
  const bleed = pad
    ? `<rect x="${-pad}" y="${-pad}" width="${tileSize + pad * 2}" height="${tileSize + pad * 2}" fill="${background}"/>`
    : "";
  const tile = rounded
    ? `<rect width="${tileSize}" height="${tileSize}" rx="8" fill="${background}"/>`
    : `<rect width="${tileSize}" height="${tileSize}" fill="${background}"/>`;
  const p = logoPlacement(tileSize, LOGO_PAD);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="${vb}">
${bleed}${tile}
<defs>
  <mask id="potion-flask" maskUnits="userSpaceOnUse" mask-type="alpha">
    <image href="${maskHref}" xlink:href="${maskHref}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" preserveAspectRatio="xMidYMid meet"/>
  </mask>
</defs>
<rect width="${tileSize}" height="${tileSize}" fill="${flask}" mask="url(#potion-flask)"/>
</svg>`;
}
