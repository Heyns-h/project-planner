import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../app/session';
import { layout, RING_STATES, type LayoutLink, type LayoutNode, type Ring, type RingState } from '../core/layout';
import { STATUS_CLASS, TYPE_LABEL } from './format';

// Blueprint §5.1 and §5.3 as revised (decisions 11–15): one level of
// free-floating circles, each named and summarising what is inside; a
// segmented ring for the tasks beneath; a tap opens a radial with Edit and
// Open; pan and pinch-zoom; drill-in shows the next level. Preact renders
// the circles from core/layout; d3-zoom owns only the camera, and writes the
// transform straight onto the world group so a pan never re-renders the
// tree. The layout is recomputed from the graph on every render and never
// stored.

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
const RING_LABEL: Record<RingState, string> = { due: 'due', near: 'near due', blocked: 'blocked', open: 'open', done: 'done' };

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

function ringText(r: Ring | null): string {
  if (!r) return '';
  return RING_STATES.filter((s) => r[s] > 0)
    .map((s) => `${r[s]} ${RING_LABEL[s]}`)
    .join(', ');
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
    </g>
  );
}

/**
 * The ring (decision 15): every task beneath, as one segment per state,
 * sized by count, with a small gap between segments. Drawn clockwise from
 * the top: due, near due, blocked, open, done.
 */
function RingArcs({ ring, r }: { ring: Ring; r: number }) {
  const ringR = Math.max(0, r - 3.5);
  const c = 2 * Math.PI * ringR;
  const present = RING_STATES.filter((s) => ring[s] > 0);
  const gap = present.length > 1 ? Math.min(3, c / (present.length * 8)) : 0;
  let start = 0;
  return (
    <>
      {present.map((s) => {
        const len = (ring[s] / ring.total) * c;
        const seg = (
          <circle key={s} class={`bb-seg seg-${s}`} r={ringR} fill="none" stroke-dasharray={`${Math.max(0, len - gap)} ${c}`} stroke-dashoffset={-(start + gap / 2)} transform="rotate(-90)" />
        );
        start += len;
        return seg;
      })}
    </>
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
  active: boolean;
  onTap: (n: LayoutNode) => void;
  onOpen: (n: LayoutNode) => void;
}

function Circle({ n, active, onTap, onOpen }: CircleProps) {
  const cls = ['bb-node', `t-${n.node.plannerType}`, STATUS_CLASS[n.node.status], n.dim ? 'bb-dim' : '', n.blocked ? 'bb-blocked' : '', n.partial ? 'bb-partial' : '', active ? 'bb-selected' : '', toneClass(n)]
    .filter(Boolean)
    .join(' ');
  const tasks = n.ring ? `; tasks beneath: ${ringText(n.ring)}` : '';
  return (
    <g
      data-node={n.node.id}
      class={cls}
      transform={`translate(${n.x},${n.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${n.node.title}, ${TYPE_LABEL[n.node.plannerType]}, ${inside(n)}${tasks}`}
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
      {n.ring && n.r >= 10 && <RingArcs ring={n.ring} r={n.r} />}
    </g>
  );
}

/**
 * The radial (decision 14): a tap shows Edit and Open beside the bubble.
 * Drawn at screen size (scaled by 1/k) just outside the rim.
 */
function Radial({ n, k, onEdit, onOpen }: { n: LayoutNode; k: number; onEdit: () => void; onOpen: () => void }) {
  const rk = n.r * k;
  const dist = rk + 34;
  const R = 22;
  const items = [
    { label: 'Edit', angle: -128, act: onEdit, cls: 'edit' },
    { label: 'Open', angle: -52, act: onOpen, cls: 'open' },
  ];
  return (
    <g class="bb-menu" transform={`translate(${n.x},${n.y}) scale(${1 / k})`} role="menu" aria-label={`${n.node.title}: actions`}>
      {items.map((it) => {
        const a = (it.angle * Math.PI) / 180;
        const x = Math.cos(a) * dist;
        const y = Math.sin(a) * dist;
        const rimX = Math.cos(a) * rk;
        const rimY = Math.sin(a) * rk;
        return (
          <g
            key={it.label}
            class={`bb-menu-item ${it.cls}`}
            role="menuitem"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              it.act();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                it.act();
              }
            }}
          >
            <line x1={rimX} y1={rimY} x2={x - Math.cos(a) * R} y2={y - Math.sin(a) * R} />
            <circle cx={x} cy={y} r={R} />
            <text x={x} y={y} text-anchor="middle" dominant-baseline="central">
              {it.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function BubbleView({ snap, root, selectedId, onSelect, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [k, setK] = useState(1);
  const [menu, setMenu] = useState<string | null>(null); // node id with the radial open
  const { w, h } = useSize(box);
  const g = snap.graph;
  const lay = useMemo(() => (w > 0 && h > 0 ? layout(g, snap.rollups, root, w, h, snap.today) : null), [g, snap.rollups, root, w, h, snap.today]);
  const rootNode = root ? g.nodes.get(root) : undefined;
  const hasNodes = (lay?.nodes.length ?? 0) > 0;

  // d3-zoom owns the camera (L11): default filter for now, taps survive a
  // 6 px wobble, double-click is ours (drill-in) rather than d3's zoom. A
  // pan or pinch closes the radial.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !hasNodes) return;
    const sel = select(svg);
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .clickDistance(6)
      .on('start', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (e.sourceEvent) setMenu(null);
      })
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

  // A new view root starts from an unmoved camera, with no radial open.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.transform, zoomIdentity);
    worldRef.current?.setAttribute('transform', '');
    setK(1);
    setMenu(null);
  }, [root, hasNodes]);

  // A tap opens the radial for that bubble (decision 14); the same tap again closes it.
  const onTap = (n: LayoutNode) => setMenu((m) => (m === n.node.id ? null : n.node.id));
  const menuNode = menu ? lay?.nodes.find((n) => n.node.id === menu) : undefined;

  return (
    <div class="pl-bubble" ref={box}>
      {lay && !hasNodes && (
        <p class="pl-muted pl-empty bb-empty">{root ? `Nothing under ${rootNode?.title ?? 'this item'} yet. Use + to add something.` : 'No projects yet. Use + to add one.'}</p>
      )}
      {lay && hasNodes && (
        <>
          <svg
            ref={svgRef}
            class="bb-svg"
            viewBox={`0 0 ${w} ${h}`}
            role="group"
            aria-label="Projects as bubbles"
            onClick={() => {
              setMenu(null);
              onSelect(null);
            }}
          >
            <g class="pl-world" ref={worldRef}>
              <g class="bb-links" aria-hidden="true">
                {lay.links.map((lk) => (
                  <Link key={`${lk.from.node.id}>${lk.to.node.id}:${lk.kind}`} link={lk} />
                ))}
              </g>
              <g class="bb-circles">
                {lay.nodes.map((n) => (
                  <Circle key={n.node.id} n={n} active={menu === n.node.id || selectedId === n.node.id} onTap={onTap} onOpen={(x) => onOpen(x.node.id)} />
                ))}
              </g>
              <g class="bb-labels">
                {lay.links.map((lk) => (
                  <LinkEnd key={`${lk.from.node.id}>${lk.to.node.id}:${lk.kind}`} link={lk} />
                ))}
                {lay.nodes.map((n) => (
                  <Label key={n.node.id} n={n} k={k} />
                ))}
                {menuNode && (
                  <Radial
                    n={menuNode}
                    k={k}
                    onEdit={() => {
                      setMenu(null);
                      onSelect(menuNode.node.id);
                    }}
                    onOpen={() => onOpen(menuNode.node.id)}
                  />
                )}
              </g>
            </g>
          </svg>
          <ul class="bb-legend" aria-label="Ring colours">
            {RING_STATES.map((s) => (
              <li key={s}>
                <span class={`bb-swatch seg-${s}`} aria-hidden="true" /> {RING_LABEL[s]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
