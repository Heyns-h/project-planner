import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../app/session';
import { layout, type LayoutLink, type LayoutNode } from '../core/layout';
import { STATUS_CLASS, TYPE_LABEL } from './format';

// Blueprint §5.1 and §5.3: nested circles, sized by open tasks, with a
// progress ring; pan and pinch-zoom; drill-in. Preact renders the circles
// from core/layout; d3-zoom owns only the camera, and writes the transform
// straight onto the world group so a pan never re-renders the tree. The
// layout is recomputed from the graph on every render and never stored.

interface Props {
  snap: Snapshot;
  root: string | null; // view root id
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void; // drill in
}

const LABEL_MIN_R = 18; // on-screen radius below which a label is hidden
const SUB_LABEL_MIN_R = 14;
const SCALE_EXTENT: [number, number] = [0.5, 8];

/**
 * Extra classes for a circle. Status and level are handled in CSS already;
 * this is the one place to add tag-based tones later (Heyns, 2026-10-01).
 */
function toneClass(n: LayoutNode): string {
  void n.node.tags;
  return '';
}

/** Fit a title into a circle: shrink the font, then cut with an ellipsis. */
function fitLabel(title: string, r: number, maxSize = 16): { text: string; size: number } {
  const size = Math.max(9, Math.min(maxSize, r / 3));
  const maxChars = Math.max(3, Math.floor((r * 1.7) / (size * 0.55)));
  const text = title.length > maxChars ? `${title.slice(0, Math.max(1, maxChars - 1))}…` : title;
  return { text, size };
}

function useSize(ref: { current: HTMLElement | null }): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (width: number, height: number) =>
      setSize((s) => (s.w === Math.round(width) && s.h === Math.round(height) ? s : { w: Math.round(width), h: Math.round(height) }));
    apply(el.clientWidth, el.clientHeight); // measure now; the observer only reports changes
    const ro = new ResizeObserver(([entry]) => {
      if (entry) apply(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Camera scale, bucketed so labels re-render a handful of times per zoom, not per frame. */
function bucket(k: number): number {
  return 2 ** (Math.round(Math.log2(k) * 2) / 2);
}

/**
 * A circle's title. Level 1 with children keeps a band above them when big
 * enough, otherwise it is titled at the centre over its (then unlabelled)
 * children; drawn after the children, with a halo, so it always reads.
 * `k` is the camera scale: hidden below an on-screen radius, and capped so
 * zooming in does not produce giant text.
 */
function Label({ n, k }: { n: LayoutNode; k: number }) {
  const minR = n.depth === 1 ? LABEL_MIN_R : SUB_LABEL_MIN_R;
  if (n.r * k < minR) return null;
  const band = n.depth === 1 && n.children.length > 0 && n.r >= 48;
  const label = band ? fitLabel(n.node.title, n.r * 1.3, 14) : fitLabel(n.node.title, n.r);
  const size = Math.min(label.size, 20 / k);
  const withCount = n.depth === 2 && n.beneath > 0 && n.r * k >= 22;
  const y = band ? -n.r + 19 : withCount ? -size * 0.45 : 0;
  return (
    <g class={`bb-text bb-d${n.depth} ${STATUS_CLASS[n.node.status]}${n.dim ? ' bb-dim' : ''}`} transform={`translate(${n.x},${n.y})`} aria-hidden="true">
      <text class="bb-label" text-anchor="middle" dominant-baseline="central" font-size={size} y={y}>
        {label.text}
      </text>
      {withCount && (
        <text class="bb-beneath" text-anchor="middle" dominant-baseline="central" font-size={Math.max(8, size * 0.75)} y={size * 0.75}>
          +{n.beneath}
        </text>
      )}
    </g>
  );
}

/** A typed link, drawn rim to rim; dotted when it crosses domains (decision 7). */
function Link({ link }: { link: LayoutLink }) {
  const { from, to } = link;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= from.r + to.r) return null; // overlapping or nested: nothing sensible to draw
  const ux = dx / d;
  const uy = dy / d;
  const x1 = from.x + ux * from.r;
  const y1 = from.y + uy * from.r;
  const x2 = to.x - ux * to.r;
  const y2 = to.y - uy * to.r;
  return (
    <g class={`bb-link k-${link.kind}${link.cross ? ' cross' : ''}`}>
      <line class="bb-link-halo" x1={x1} y1={y1} x2={x2} y2={y2} />
      <line class="bb-link-line" x1={x1} y1={y1} x2={x2} y2={y2} />
      {link.kind === 'blockedBy' && <circle class="bb-link-end" cx={x2} cy={y2} r={3.5} />}
    </g>
  );
}

interface CircleProps {
  n: LayoutNode;
  selected: boolean;
  onTap: (n: LayoutNode) => void;
  onOpen: (n: LayoutNode) => void;
}

function Circle({ n, selected, onTap, onOpen }: CircleProps) {
  // The ring hugs the rim so the title band stays clear.
  const ringR = Math.max(0, n.r - (n.depth === 1 ? 3.5 : Math.max(2, n.r * 0.06)));
  const circumference = 2 * Math.PI * ringR;
  const pct = n.percent ?? 0;
  const cls = [
    'bb-node',
    `bb-d${n.depth}`,
    `t-${n.node.plannerType}`,
    STATUS_CLASS[n.node.status],
    n.dim ? 'bb-dim' : '',
    n.blocked ? 'bb-blocked' : '',
    n.partial ? 'bb-partial' : '',
    selected ? 'bb-selected' : '',
    toneClass(n),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      data-node={n.node.id}
      class={cls}
      transform={`translate(${n.x},${n.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${n.node.title}, ${TYPE_LABEL[n.node.plannerType]}, ${n.open} open task${n.open === 1 ? '' : 's'}`}
      onClick={(e) => {
        e.stopPropagation();
        onTap(n);
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        onOpen(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen(n);
        } else if (e.key === ' ') {
          e.preventDefault();
          onTap(n);
        }
      }}
    >
      <circle class="bb-fill" r={n.r} />
      {n.percent !== null && n.r >= 10 && (
        <circle class="bb-ring" r={ringR} fill="none" stroke-dasharray={`${(pct / 100) * circumference} ${circumference}`} transform="rotate(-90)" />
      )}
    </g>
  );
}

export function BubbleView({ snap, root, selectedId, onSelect, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const lastPointer = useRef<string>('mouse');
  const [k, setK] = useState(1);
  const { w, h } = useSize(box);
  const g = snap.graph;
  const lay = useMemo(() => (w > 0 && h > 0 ? layout(g, snap.rollups, root, w, h) : null), [g, snap.rollups, root, w, h]);
  const rootNode = root ? g.nodes.get(root) : undefined;
  const hasNodes = (lay?.nodes.length ?? 0) > 0;

  // d3-zoom owns the camera (L11): default filter for now, taps survive a
  // 6 px wobble, double-click is ours (drill-in) rather than d3's zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !hasNodes) return;
    const sel = select(svg);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .clickDistance(6)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        worldRef.current?.setAttribute('transform', e.transform.toString());
        setK((prev) => (bucket(e.transform.k) === prev ? prev : bucket(e.transform.k)));
      })
      .on('end', (e: D3ZoomEvent<SVGSVGElement, unknown>) => setK(e.transform.k));
    sel.call(z).on('dblclick.zoom', null);
    zoomRef.current = z;
    return () => {
      sel.on('.zoom', null);
      zoomRef.current = null;
    };
  }, [hasNodes]);

  // A new view root starts from an unmoved camera.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.transform, zoomIdentity);
    worldRef.current?.setAttribute('transform', '');
    setK(1);
  }, [root, hasNodes]);

  // Phone: a tap selects, a tap on the selected circle drills in (decision 2).
  // Desktop: click selects, double-click drills in.
  const onTap = (n: LayoutNode) => {
    if (lastPointer.current === 'touch' && selectedId === n.node.id) onOpen(n.node.id);
    else onSelect(n.node.id);
  };

  return (
    <div class="pl-bubble" ref={box}>
      {lay && !hasNodes && (
        <p class="pl-muted pl-empty bb-empty">{root ? `Nothing under ${rootNode?.title ?? 'this item'} yet. Use + to add something.` : 'No projects yet. Use + to add one.'}</p>
      )}
      {lay && hasNodes && (
        <svg
          ref={svgRef}
          class="bb-svg"
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
          role="group"
          aria-label="Projects as bubbles"
          onPointerDownCapture={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onClick={() => onSelect(null)}
        >
          <g class="pl-world" ref={worldRef}>
            <g class="bb-circles">
              {lay.nodes.map((n) => (
                <g key={n.node.id} class="bb-group">
                  <Circle n={n} selected={selectedId === n.node.id} onTap={onTap} onOpen={(x) => onOpen(x.node.id)} />
                  {n.children.map((c) => (
                    <Circle key={c.node.id} n={c} selected={selectedId === c.node.id} onTap={onTap} onOpen={(x) => onOpen(x.node.id)} />
                  ))}
                </g>
              ))}
            </g>
            <g class="bb-links" aria-hidden="true">
              {lay.links.map((lk) => (
                <Link key={`${lk.from.node.id}>${lk.to.node.id}:${lk.kind}`} link={lk} />
              ))}
            </g>
            <g class="bb-labels">
              {lay.all.map((n) => (
                <Label key={n.node.id} n={n} k={k} />
              ))}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}
