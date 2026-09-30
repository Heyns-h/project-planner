import { useMemo, useState } from 'preact/hooks';

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  label: string;
  options: Option[];
  selected: string[];
  multi: boolean;
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** Offer "Add '<text>'" when nothing matches exactly (e.g. a new person). */
  onCreate?: (text: string) => void;
  createLabel?: string;
  disabled?: boolean;
}

const MAX_SHOWN = 8;

// Searchable picker for people, tags and links. Selected values show as
// removable chips; typing filters the options.
export function Picker({ label, options, selected, multi, onChange, placeholder, onCreate, createLabel, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  const q = query.trim().toLowerCase();
  const matches = options
    .filter((o) => !selected.includes(o.value))
    .filter((o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
    .slice(0, MAX_SHOWN);
  const exact = options.some((o) => o.label.toLowerCase() === q || o.value.toLowerCase() === q);

  const pick = (v: string) => {
    onChange(multi ? [...selected, v] : [v]);
    setQuery('');
    setOpen(multi);
  };

  return (
    <div class="pl-picker">
      <span class="pl-field-label">{label}</span>
      {selected.length > 0 && (
        <div class="pl-chips">
          {selected.map((v) => (
            <span class="pl-chip" key={v}>
              {byValue.get(v)?.label ?? v}
              {!disabled && (
                <button type="button" aria-label={`Remove ${byValue.get(v)?.label ?? v}`} onClick={() => onChange(selected.filter((s) => s !== v))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (multi || selected.length === 0) && (
        <input
          type="search"
          value={query}
          placeholder={placeholder ?? 'Search…'}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label={label}
        />
      )}
      {open && (matches.length > 0 || (onCreate && q && !exact)) && (
        <ul class="pl-options" role="listbox">
          {matches.map((o) => (
            <li key={o.value}>
              <button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}>
                <span>{o.label}</span>
                {o.hint && <span class="pl-muted">{o.hint}</span>}
              </button>
            </li>
          ))}
          {onCreate && q && !exact && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onCreate(query.trim());
                  setQuery('');
                }}
              >
                <span>{createLabel ?? 'Add'} “{query.trim()}”</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
