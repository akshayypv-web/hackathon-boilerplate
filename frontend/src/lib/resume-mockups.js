const ACCENT = '#FF5A36';
const TINT = '#FFEDE6';
const LINE = '#E3DCCF';
const LINE_SOFT = '#EEE8DC';
const CARD_BG = '#FFFFFF';
const BORDER = '#E7DFD1';

function lineRects(x, startY, widths, height, gap, fill) {
  return widths
    .map((w, i) => `<rect x="${x}" y="${startY + i * gap}" width="${w}" height="${height}" rx="${height / 2}" fill="${fill}"/>`)
    .join('');
}

/** Deterministic resume-mockup SVG card — no external images, no real resumes. */
function buildResumeSvg(variant) {
  const {
    headerWidth,
    sideLines,
    section1,
    section2,
    section3,
  } = variant;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" width="240" height="320">
  <rect x="1" y="1" width="238" height="318" rx="12" fill="${CARD_BG}" stroke="${BORDER}" stroke-width="2"/>

  <rect x="18" y="22" width="${headerWidth}" height="15" rx="4" fill="${ACCENT}"/>
  <rect x="18" y="43" width="96" height="7" rx="3.5" fill="${LINE}"/>
  <rect x="18" y="62" width="204" height="1.5" fill="${BORDER}"/>

  <rect x="12" y="70" width="70" height="238" rx="8" fill="${TINT}"/>
  <rect x="24" y="84" width="40" height="6" rx="3" fill="${ACCENT}"/>
  ${lineRects(24, 98, sideLines, 6, 15, '#F3B39F')}

  <rect x="96" y="84" width="${section1.heading}" height="6" rx="3" fill="${ACCENT}"/>
  ${lineRects(96, 98, section1.lines, 6, 13, LINE)}

  <rect x="96" y="${section1.nextY}" width="${section2.heading}" height="6" rx="3" fill="${ACCENT}"/>
  ${lineRects(96, section1.nextY + 14, section2.lines, 6, 13, LINE_SOFT)}

  <rect x="96" y="${section2.nextY}" width="${section3.heading}" height="6" rx="3" fill="${ACCENT}"/>
  ${lineRects(96, section2.nextY + 14, section3.lines, 6, 13, LINE)}
</svg>`.trim();

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const VARIANTS = [
  {
    headerWidth: 108,
    sideLines: [36, 44, 28, 40, 32],
    section1: { heading: 58, lines: [126, 118, 96], nextY: 148 },
    section2: { heading: 46, lines: [126, 104], nextY: 192 },
    section3: { heading: 52, lines: [126, 110, 70], nextY: 232 },
  },
  {
    headerWidth: 132,
    sideLines: [30, 40, 40, 24],
    section1: { heading: 46, lines: [126, 100, 118, 84], nextY: 164 },
    section2: { heading: 60, lines: [126, 96], nextY: 208 },
    section3: { heading: 40, lines: [126, 120], nextY: 246 },
  },
  {
    headerWidth: 90,
    sideLines: [40, 26, 36, 40, 22],
    section1: { heading: 52, lines: [126, 108], nextY: 136 },
    section2: { heading: 44, lines: [126, 118, 90, 100], nextY: 176 },
    section3: { heading: 58, lines: [126, 94], nextY: 232 },
  },
  {
    headerWidth: 120,
    sideLines: [32, 40, 32],
    section1: { heading: 64, lines: [126, 112, 126, 76], nextY: 164 },
    section2: { heading: 40, lines: [126, 90], nextY: 208 },
    section3: { heading: 48, lines: [126, 116, 60], nextY: 246 },
  },
];

export const RESUME_MOCKUPS = VARIANTS.map((v, i) => ({
  src: buildResumeSvg(v),
  alt: `Resume mockup ${i + 1}`,
}));
