import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../app/session';
import { layout, type LayoutLink, type LayoutNode } from '../core/layout';
import { STATUS_CLASS, TYPE_LABEL } from './format';

// Blueprint §5.1 and §5.3 as revised (decisions 11–12): one level of
// free-floating circles, each named and summarising what is inside; pan and
// pinch-zoom; drill-in shows the next level. Preact renders the circles from
// core/layout; d3-zoom owns only the camera, and writes the transform
// straight onto the world group so a pan never re-renders the tree. The
// layout is recomputed from the graph on every render and never stored.

interface Props {
  snap: Snapshot;
  root: string | null; // view root id
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void; // drill in
}

const NAME_MIN_R = 16; // on-screen radius below which the name is hidden
const DETAIL_MIN_R = 30; // … and the "what's inside" line
const SCALE_EXTENT: [number, number] = [0.5, 8];

/**
 * Extra classes for a circle. Status and level are handled in CSS already;
 * this is the one place to add tag-based tones later (Heyns, 2026-10-01).
 */
function toneClass(n: LayoutNode): string {
  void n.node.tags;
  return '';
}

/** Fit text into a width: shrink the font, then cut with an ellipsis. */
function fit(text: string, width: number, maxSize: number, minSize = 9): { text: string; size: number } {
  const size = Math.max(minSize, Math.min(maxSize, width / 6));
  const maxChars = Math.max(3, Math.floor(width / (size * 0.55)));
  return { text: text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text, size };
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

function inside(n: LayoutNode): string {
  const parts: string[] = [];
  parts.push(n.children === 0 ? 'nothing inside' : n.children === 1 ? '1 inside' : `${n.children} inside`);
  if (n.attachments > 0) parts.push(`${n.attachments} file${n.attachments === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * Name and summary, drawn after every circle so they always read. `k` is the
 * camera scale: hidden below an on-screen radius, and capped so zooming in
 * does not produce giant text.
 */
function Label({ n, k }: { n: LayoutNode; k: number }) {
  const onScreen = n.r * k;
  if (onScreen < NAME_MIN_R) return null;
  const width = n.r * 1.7;
  const name = fit(n.node.title, width, Math.min(16, 20 / k));
  const detail = onScreen >= DETAIL_MIN_R ? fit(inside(n), width, Math.min(11, 14 / k), 8) : null;
  const dueR = Math.max(7, Math.min(13, n.r * 0.18));
  const showDue = n.dueSoon > 0 && onScreen >= 20;
  return (
    <g class={`bb-text ${STATUS_CLASS[n.node.status]}${n.dim ? ' bb-dim' : ''}`} transform={`translate(${n.x},${n.y})`} aria-hidden="true">
      <text class="bb-label" text-anchor="middle" dominant-baseline="central" font-size={name.size} y={detail ? -name.size * 0.45 : 0}>
        {name.text}
      </text>
      {detail && (
        <text class="bb-detail" text-anchor="middle" dominant-baseline="central" font-size={detail.size} y={name.size * 0.6}>
          {detail.text}
        </text>
      )}
      {showDue && (
        <g class={`bb-due${n.dueCritical > 0 ? ' critical' : ' soon'}`} transform={`translate(0,${n.r * 0.58})`}>
          <circle r={dueR} />
          <text text-anchor="middle" dominant-baseline="central" font-size={Math.max(8, dueR * 1.1)}>
            {n.dueSoon}
          </text>
        </g>
      )}
    </g>
  );
}

/** Rim-to-rim end points of a link, or null when the circles overlap. */
function ends(link: LayoutLink): { x1: number; y1: number; x2: number; y2: number } | null {
  const { from, to } = link;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= from.r + to.r) return null;
  const ux = dx / d;
  const uy = dy / d;
  return { x1: from.x + ux * from.r, y1: from.y + uy * from.r, x2: to.x - ux * to.r, y2: to.y - uy * to.r };
}

/** A typed link, drawn rim to rim beneath the circles; dotted when it crosses domains (decision 7). */
function Link({ link }: { link: LayoutLink }) {
  const e = ends(link);
  if (!e) return null;
  return (
    <g class={`bb-link k-${link.kind}${link.cross ? ' cross' : ''}`}>
      <line class="bb-link-halo" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
      <line class="bb-link-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
    </g>
  );
}

/** The blocker's end of a blocked-by link, drawn above the circles so it is not hidden. */
function LinkEnd({ link }: { link: LayoutLink }) {
  const e = ends(link);
  if (!e || link.kind !== 'blockedBy') return null;
  return <circle class="bb-link-end" cx={e.x2} cy={e.y2} r={3.5} />;
}

interface CircleProps {
  n: LayoutNode;
  selected: boolean;
  onTap: (n: LayoutNode) => void;
  onOpen: (n: LayoutNode) => void;
}

function Circle({ n, selected, onTap, onOpen }: CircleProps) {
  const ringR = Math.max(0, n.r - 3.5); // hugs the rim
  const circumference = 2 * Math.PI * ringR;
  const pct = n.percent ?? 0;
  const cls = ['bb-node', `t-${n.node.plannerType}`, STATUS_CLASS[n.node.status], n.dim ? 'bb-dim' : '', n.blocked ? 'bb-blocked' : '', n.partial ? 'bb-partial' : '', selected ? 'bb-selected' : '', toneClass(n)]
    .filter(Boolean)
    .join(' ');
  const due = n.dueSoon > 0 ? `, ${n.dueSoon} due soon` : '';
  return (
    <g
      data-node={n.node.id}
      class={cls}
      transform={`translate(${n.x},${n.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${n.node.title}, ${TYPE_LABEL[n.node.plannerType]}, ${inside(n)}, ${n.open} open task${n.open === 1 ? '' : 's'}${due}`}
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
  const lay = useMemo(() => (w > 0 && h > 0 ? layout(g, snap.rollups, root, w, h, snap.today) : null), [g, snap.rollups, root, w, h, snap.today]);
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
          role="group"
          aria-label="Projects as bubbles"
          onPointerDownCapture={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onClick={() => onSelect(null)}
        >
          <g class="pl-world" ref={worldRef}>
            <g class="bb-links" aria-hidden="true">
              {lay.links.map((lk) => (
                <Link key={`${lk.from.node.id}>${lk.to.node.id}:${lk.kind}`} link={lk} />
              ))}
            </g>
            <g class="bb-circles">
              {lay.nodes.map((n) => (
                <Circle key={n.node.id} n={n} selected={selectedId === n.node.id} onTap={onTap} onOpen={(x) => onOpen(x.node.id)} />
              ))}
            </g>
            <g class="bb-labels">
              {lay.links.map((lk) => (
                <LinkEnd key={`${lk.from.node.id}>${lk.to.node.id}:${lk.kind}`} link={lk} />
              ))}
              {lay.nodes.map((n) => (
                <Label key={n.node.id} n={n} k={k} />
              ))}
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}
