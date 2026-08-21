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

/** Vertices of an equal-armed plus (Patch Server — RULESET.md §14): a 12-point cross outline. */
function plusPoints(cx: number, cy: number, r: number): string {
  const arm = r * 0.4;
  const reach = r * 1.1;
  const corners: [number, number][] = [
    [arm, reach], [-arm, reach], [-arm, arm], [-reach, arm], [-reach, -arm], [-arm, -arm],
    [-arm, -reach], [arm, -reach], [arm, -arm], [reach, -arm], [reach, arm], [arm, arm],
  ];
  return corners.map(([dx, dy]) => `${cx + dx},${cy + dy}`).join(" ");
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
    // v2-only node types (RULESET.md §14, PLAN.md 8.2a):
    case "plus":
      return <polygon points={plusPoints(cx, cy, r)} {...common} />;
    case "pentagon":
      return <polygon points={regularPolygonPoints(cx, cy, r * 1.1, 5, -90)} {...common} />;
    case "burst":
      return <polygon points={starPoints(cx, cy, r * 1.15, r * 0.75, 8, -90)} {...common} />;
    case "bar": {
      const halfWidth = r * 1.15;
      const halfHeight = r * 0.4;
      return <rect x={cx - halfWidth} y={cy - halfHeight} width={halfWidth * 2} height={halfHeight * 2} rx={2} {...common} />;
    }
    case "ring":
      return (
        <>
          <circle cx={cx} cy={cy} r={r * 0.75} fill="none" stroke={fill} strokeWidth={r * 0.5} />
          <circle cx={cx} cy={cy} r={r * 1.05} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        </>
      );
    case "circle":
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}
