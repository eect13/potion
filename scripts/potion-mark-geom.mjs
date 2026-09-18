/** Shared flask + italic P geometry (32×32 design space). */

export const INK = "#0a0b0a";
export const CREAM = "#d7dbd4";
export const INK_RGB = [0x0a, 0x0b, 0x0a];
export const CREAM_RGB = [0xd7, 0xdb, 0xd4];

const SKEW = Math.tan((-16 * Math.PI) / 180);

export const MARK_FLASK = `
  <path d="M-3.9-12.15a3.9 1.55 0 0 1 7.8 0v2.2c0 .42-.4.75-.88.75h-6.04c-.48 0-.88-.33-.88-.75z"/>
  <rect x="-3.95" y="-9.2" width="7.9" height="1.6" rx=".42"/>
  <path d="M-1.7-7.6h3.4v2.5c2.15.95 5.7 3.05 5.7 8.2a7.85 8.15 0 1 1-15.7 0c0-5.15 3.55-7.25 5.7-8.2v-2.5z"/>
`;

export const MARK_CUTS = `
  <circle cx="-4.35" cy="2.55" r="1.05"/>
  <circle cx="-3.15" cy="4.45" r=".48"/>
  <g transform="skewX(-16)">
    <path fill-rule="evenodd" d="M-2.7.15v8.55h1.72V5.2h1.42c2.42 0 3.82-1.28 3.82-3.12 0-1.84-1.32-1.93-3.55-1.93H-2.7zm1.72 1.48h1.48c1.18 0 1.88.36 1.88 1.22s-.7 1.3-1.88 1.3h-1.48V1.63z"/>
  </g>
`;

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inFlask(x, y) {
  if (inEllipse(x, y, 16, 3.85, 3.9, 1.55)) return true;
  if (x >= 12.1 && x <= 19.9 && y >= 3.85 && y <= 6.2) return true;
  if (x >= 12.05 && x <= 19.95 && y >= 6.8 && y <= 8.4) return true;
  if (x >= 14.3 && x <= 17.7 && y >= 7.4 && y <= 11.4) return true;
  return inEllipse(x, y, 16, 20.25, 7.85, 8.15);
}

function inShine(x, y) {
  return inEllipse(x, y, 11.65, 18.55, 1.05, 1.05) || inEllipse(x, y, 12.85, 20.45, 0.48, 0.48);
}

function unskewX(x, y) {
  return x - (y - 16) * SKEW;
}

function inP(x, y) {
  const sx = unskewX(x, y);
  if (sx >= 13.3 && sx <= 15.02 && y >= 16.15 && y <= 24.7) return true;
  const inBowl = sx >= 13.3 && sx <= 17.24 && y >= 16.15 && y <= 19.35;
  if (!inBowl) return false;
  const inHole = sx >= 15.02 && sx <= 16.9 && y >= 17.63 && y <= 19.2;
  return !inHole;
}

/** True when the pixel should be cream (flask body), not ink (tile / P / shine). */
export function inCream(x, y) {
  return x >= 0 && x <= 32 && y >= 0 && y <= 32 && inFlask(x, y) && !inP(x, y) && !inShine(x, y);
}
