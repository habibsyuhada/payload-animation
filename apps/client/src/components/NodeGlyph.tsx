import type { NodeShape } from "../data/defenseNodeCatalog.js";

/** Vertices of a regular polygon centered at (cx,cy) — `rotationDeg` of 0 puts the first vertex
 * due right (standard math angle convention); e.g. -90 puts it pointing straight up. */
function regularPolygonPoints(cx: number, cy: number, r: number, sides: number, rotationDeg: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Vertices of a `spikes`-pointed star, alternating between `outerR` and `innerR`. */
function starPoints(cx: number, cy: number, outerR: number, innerR: number, spikes: number, rotationDeg: number): string {
  const step = 360 / (spikes * 2);
  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = ((rotationDeg + step * i) * Math.PI) / 180;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

export interface NodeGlyphProps {
  readonly shape: NodeShape;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/** Renders a node's silhouette — distinct per type (see NodeShape) so nodes read apart by shape,
 * not just fill color: Core is a diamond, Entry a triangle, and each placeable type gets its own
 * polygon (Router stays a plain circle — the untiered, "default" node). */
export function NodeGlyph({ shape, cx, cy, r, fill, stroke, strokeWidth }: NodeGlyphProps): JSX.Element {
  const common = { fill, stroke, strokeWidth };
  switch (shape) {
    case "diamond":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.15, 4, -90)} {...common} />;
    case "triangle":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.2, 3, 0)} {...common} />;
    case "triangle-down":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.2, 3, 90)} {...common} />;
    case "square": {
      const half = r * 0.85;
      return <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} rx={3} {...common} />;
    }
    case "hexagon":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.05, 6, -90)} {...common} />;
    case "octagon":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.05, 8, -67.5)} {...common} />;
    case "star":
      return <polygon points={starPoints(cx, cy, r * 1.3, r * 0.55, 6, -90)} {...common} />;
    case "circle":
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}
