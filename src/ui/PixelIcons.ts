const SVG_NS = 'http://www.w3.org/2000/svg';

export type PixelIconName =
  | 'palette'
  | 'gear'
  | 'expand'
  | 'exit'
  | 'save'
  | 'cartridge'
  | 'home'
  | 'refresh'
  | 'sparkle'
  | 'flask'
  | 'trash'
  | 'camera'
  | 'play'
  | 'speaker'
  | 'screen';

type PixelRect = readonly [x: number, y: number, w: number, h: number, opacity?: number];

const PIXEL_ICON_RECTS: Record<PixelIconName, readonly PixelRect[]> = {
  palette: [
    [4, 2, 8, 2],
    [2, 4, 2, 6],
    [12, 4, 2, 4],
    [10, 8, 4, 2],
    [4, 10, 2, 4],
    [6, 12, 6, 2],
    [4, 4, 8, 6, 0.24],
    [5, 5, 2, 2],
    [9, 5, 2, 2],
    [5, 8, 2, 2],
    [9, 9, 2, 2, 0.45],
  ],
  gear: [
    [6, 1, 4, 2],
    [6, 13, 4, 2],
    [1, 6, 2, 4],
    [13, 6, 2, 4],
    [3, 3, 2, 2],
    [11, 3, 2, 2],
    [3, 11, 2, 2],
    [11, 11, 2, 2],
    [4, 3, 8, 2],
    [4, 11, 8, 2],
    [3, 4, 2, 8],
    [11, 4, 2, 8],
    [5, 5, 6, 6, 0.24],
    [6, 6, 4, 4],
  ],
  expand: [
    [2, 2, 4, 2],
    [2, 4, 2, 2],
    [10, 2, 4, 2],
    [12, 4, 2, 2],
    [2, 10, 2, 4],
    [4, 12, 2, 2],
    [12, 10, 2, 4],
    [10, 12, 2, 2],
    [5, 5, 6, 6, 0.24],
  ],
  exit: [
    [5, 3, 2, 2],
    [3, 5, 2, 2],
    [1, 6, 11, 2],
    [3, 8, 2, 2],
    [5, 10, 2, 2],
    [11, 7, 2, 5],
    [6, 12, 7, 2],
  ],
  save: [
    [2, 2, 10, 2],
    [11, 3, 3, 2],
    [2, 4, 2, 10],
    [12, 5, 2, 9],
    [4, 12, 8, 2],
    [5, 3, 5, 4, 0.35],
    [5, 9, 6, 3, 0.3],
    [4, 4, 2, 2],
  ],
  cartridge: [
    [3, 2, 8, 2],
    [11, 3, 2, 2],
    [3, 4, 2, 10],
    [11, 5, 2, 9],
    [5, 12, 6, 2],
    [5, 5, 6, 5, 0.32],
    [6, 10, 4, 2],
  ],
  home: [
    [7, 2, 2, 2],
    [5, 4, 6, 2],
    [3, 6, 10, 2],
    [2, 7, 2, 2],
    [12, 7, 2, 2],
    [4, 8, 2, 6],
    [10, 8, 2, 6],
    [4, 12, 8, 2],
    [7, 9, 2, 4, 0.35],
  ],
  refresh: [
    [5, 2, 6, 2],
    [3, 4, 2, 4],
    [11, 3, 2, 4],
    [9, 5, 4, 2],
    [5, 12, 6, 2],
    [11, 8, 2, 4],
    [3, 9, 2, 4],
    [3, 9, 4, 2],
  ],
  sparkle: [
    [7, 1, 2, 14],
    [1, 7, 14, 2],
    [5, 5, 6, 6, 0.45],
    [6, 6, 4, 4],
    [2, 2, 2, 2, 0.7],
    [12, 12, 2, 2, 0.7],
  ],
  flask: [
    [5, 2, 6, 2],
    [6, 4, 4, 3],
    [4, 7, 2, 3],
    [10, 7, 2, 3],
    [2, 10, 2, 3],
    [12, 10, 2, 3],
    [3, 13, 10, 2],
    [4, 10, 8, 3, 0.4],
  ],
  trash: [
    [6, 2, 4, 2],
    [2, 4, 12, 2],
    [4, 6, 2, 8],
    [10, 6, 2, 8],
    [5, 12, 6, 2],
    [7, 7, 2, 4, 0.65],
  ],
  camera: [
    [5, 3, 6, 2],
    [2, 5, 12, 2],
    [2, 7, 2, 6],
    [12, 7, 2, 6],
    [3, 12, 10, 2],
    [6, 7, 4, 4, 0.35],
    [7, 8, 2, 2],
  ],
  play: [
    [4, 3, 2, 10],
    [6, 4, 2, 8],
    [8, 5, 2, 6],
    [10, 6, 2, 4],
    [12, 7, 1, 2],
  ],
  speaker: [
    [2, 6, 3, 4],
    [5, 4, 2, 8],
    [7, 2, 2, 12],
    [11, 5, 2, 6],
    [13, 3, 2, 10, 0.65],
  ],
  screen: [
    [2, 2, 12, 2],
    [2, 4, 2, 7],
    [12, 4, 2, 7],
    [2, 10, 12, 2],
    [6, 12, 4, 2],
    [4, 13, 8, 2],
    [5, 6, 6, 2, 0.45],
  ],
};

export function createPixelIcon(name: PixelIconName, extraClass?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', extraClass ? `pixel-icon ${extraClass}` : 'pixel-icon');

  const rects = PIXEL_ICON_RECTS[name];
  for (let i = 0; i < rects.length; i++) {
    const [x, y, w, h, opacity] = rects[i];
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', 'currentColor');
    if (opacity !== undefined) {
      r.setAttribute('fill-opacity', String(opacity));
    }
    svg.appendChild(r);
  }
  return svg;
}

export function setElementIconLabel(
  target: HTMLElement,
  icon: PixelIconName,
  label: string,
): void {
  target.replaceChildren(createPixelIcon(icon), document.createTextNode(label));
}
