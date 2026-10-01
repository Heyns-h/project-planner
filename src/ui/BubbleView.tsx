import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../app/session';
import { layout, type LayoutNode } from '../core/layout';
import { STATUS_CLASS, TYPE_LABEL } from './format';

// Blueprint §5.1: nested circles, sized by open tasks, coloured by status,
// with a progress ring. Preact renders the circles from core/layout; d3 will
// own only the camera (step 2b). The layout is recomputed from the graph on
// every render and never stored.

interface Props {
  snap: Snapshot;
  root: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const LABEL_MIN_R = 18; // below this on-screen radius a label is hidden
const SUB_LABEL_MIN_R = 14;

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
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.w === Math.round(width) && s.h === Math.round(height) ? s : { w: Math.round(width), h: Math.round(height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * A circle's title. Level 1 with children keeps a band above them when big
 * enough, otherwise it is titled at the centre over its (then unlabelled)
 * children; drawn after the children, with a halo, so it always reads.
 */
function Label({ n }: { n: LayoutNode }) {
  const minR = n.depth === 1 ? LABEL_MIN_R : SUB_LABEL_MIN_R;
  if (n.r < minR) return null;
  const band = n.depth === 1 && n.children.length > 0 && n.r >= 48;
  const label = band ? fitLabel(n.node.title, n.r * 1.3, 14) : fitLabel(n.node.title, n.r);
  const withCount = n.depth === 2 && n.beneath > 0 && n.r >= 22;
  const y = band ? -n.r + 19 : withCount ? -label.size * 0.45 : 0;
  return (
    <g class={`bb-text bb-d${n.depth} ${STATUS_CLASS[n.node.status]}${n.dim ? ' bb-dim' : ''}`} transform={`translate(${n.x},${n.y})`} aria-hidden="true">
      <text class="bb-label" text-anchor="middle" dominant-baseline="central" font-size={label.size} y={y}>
        {label.text}
      </text>
      {withCount && (
        <text class="bb-beneath" text-anchor="middle" dominant-baseline="central" font-size={Math.max(8, label.size * 0.75)} y={label.size * 0.75}>
          +{n.beneath}
        </text>
      )}
    </g>
  );
}

function Circle({ n, selected, onSelect }: { n: LayoutNode; selected: boolean; onSelect: (id: string) => void }) {
  // The ring hugs the rim so the title band stays clear.
  const ringR = Math.max(0, n.r - (n.depth === 1 ? 3.5 : Math.max(2, n.r * 0.06)));
  const circumference = 2 * Math.PI * ringR;
  const pct = n.percent ?? 0;
  return (
    <g
      data-node={n.node.id}
      class={`bb-node bb-d${n.depth} ${STATUS_CLASS[n.node.status]}${n.dim ? ' bb-dim' : ''}${n.blocked ? ' bb-blocked' : ''}${selected ? ' bb-selected' : ''}`}
      transform={`translate(${n.x},${n.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${n.node.title}, ${TYPE_LABEL[n.node.plannerType]}, ${n.open} open task${n.open === 1 ? '' : 's'}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(n.node.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(n.node.id);
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

export function BubbleView({ snap, root, selectedId, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const g = snap.graph;
  const lay = useMemo(() => (w > 0 && h > 0 ? layout(g, snap.rollups, root, w, h) : null), [g, snap.rollups, root, w, h]);
  const rootNode = root ? g.nodes.get(root) : undefined;

  return (
    <div class="pl-bubble" ref={box}>
      {lay && lay.nodes.length === 0 && (
        <p class="pl-muted pl-empty bb-empty">{root ? `Nothing under ${rootNode?.title ?? 'this item'} yet. Use + to add something.` : 'No projects yet. Use + to add one.'}</p>
      )}
      {lay && lay.nodes.length > 0 && (
        <svg class="bb-svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="group" aria-label="Projects as bubbles" onClick={() => onSelect(null)}>
          <g class="pl-world">
            {lay.nodes.map((n) => (
              <g key={n.node.id} class="bb-group">
                <Circle n={n} selected={selectedId === n.node.id} onSelect={onSelect} />
                {n.children.map((c) => (
                  <Circle key={c.node.id} n={c} selected={selectedId === c.node.id} onSelect={onSelect} />
                ))}
                {n.children.map((c) => (
                  <Label key={c.node.id} n={c} />
                ))}
                <Label n={n} />
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
