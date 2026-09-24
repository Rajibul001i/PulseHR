import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Type-ahead search and searchable pickers.
 *
 * Both follow the ARIA combobox pattern: the text box is the combobox, the dropdown is a
 * listbox, Up/Down move through suggestions, Enter picks, Escape closes. Focus never leaves
 * the text box, so keyboard and screen-reader users get the same shortcut as mouse users.
 */

export interface ComboOption {
  id: string;
  label: string;
  /** Second line, e.g. "EMP-0001 · Engineering". Also searched. */
  detail?: string;
}

const norm = (s: string) => s.toLowerCase().trim();

/** Options containing every word of the query, those starting with it first. */
export function filterOptions(options: ComboOption[], query: string, limit = 50): ComboOption[] {
  const q = norm(query);
  if (!q) return options.slice(0, limit);
  const words = q.split(/\s+/);
  return options
    .filter((o) => {
      const hay = norm(`${o.label} ${o.detail ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(norm(b.label).startsWith(q)) - Number(norm(a.label).startsWith(q)))
    .slice(0, limit);
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = norm(query);
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function OptionList({
  listId,
  items,
  active,
  query,
  onPick,
  onHover,
  emptyText,
}: {
  listId: string;
  items: ComboOption[];
  active: number;
  query: string;
  onPick: (o: ComboOption) => void;
  onHover: (i: number) => void;
  emptyText?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <ul className="combo-list" id={listId} role="listbox" ref={ref}>
      {items.length === 0 ? (
        <li className="combo-empty" role="presentation">
          {emptyText ?? 'No matches'}
        </li>
      ) : (
        items.map((o, i) => (
          <li
            key={o.id || '__none__'}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="combo-option"
            // mousedown, not click: picking must happen before the text box loses focus
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="combo-label">
              <Highlight text={o.label} query={query} />
            </span>
            {o.detail && (
              <span className="combo-detail">
                <Highlight text={o.detail} query={query} />
              </span>
            )}
          </li>
        ))
      )}
    </ul>
  );
}

function useListKeys(count: number, open: boolean, setOpen: (v: boolean) => void) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [count]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>, pick: (i: number) => void, submit?: () => void) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && active < count) {
        e.preventDefault();
        pick(active);
      } else if (submit) {
        e.preventDefault();
        setOpen(false);
        submit();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };
  return { active, setActive, onKey };
}

/* ------------------------------ search box ------------------------------- */

/**
 * A search box whose suggestions drop down as you type. Picking a suggestion calls
 * `onPick`; pressing Enter without picking one calls `onSubmit` with the typed text.
 * `suggest` may be synchronous (a list already loaded) or fetch from the server.
 */
export function SearchBox({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  suggest,
  onPick,
  minChars = 1,
  style,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  suggest: (query: string) => ComboOption[] | Promise<ComboOption[]>;
  onPick: (o: ComboOption) => void;
  minChars?: number;
  style?: React.CSSProperties;
}) {
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComboOption[]>([]);
  const seq = useRef(0);
  const { active, setActive, onKey } = useListKeys(items.length, open, setOpen);

  useEffect(() => {
    if (value.trim().length < minChars) {
      setItems([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const found = await suggest(value);
        if (mine === seq.current) setItems(found.slice(0, 8));
      } catch {
        if (mine === seq.current) setItems([]);
      }
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minChars]);

  const pick = (o: ComboOption) => {
    setOpen(false);
    onPick(o);
  };
  const showList = open && value.trim().length >= minChars;

  return (
    <div className="combo" style={style}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => onKey(e, (i) => pick(items[i]!), () => onSubmit(value))}
      />
      {showList && (
        <OptionList
          listId={listId}
          items={items}
          active={active}
          query={value}
          onPick={pick}
          onHover={setActive}
          emptyText="No suggestions. Press Enter to search."
        />
      )}
    </div>
  );
}

/* -------------------------------- picker --------------------------------- */

/**
 * A searchable replacement for a long <select>. Shows the chosen option; focus it and type to
 * filter, or open it and scroll. `noneLabel` adds an empty choice (e.g. "None").
 */
export function Picker({
  id,
  options,
  value,
  onChange,
  placeholder = 'Type to search…',
  noneLabel,
  disabled,
  required,
}: {
  id: string;
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  noneLabel?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const listId = `${useId()}-list`;
  const all = noneLabel ? [{ id: '', label: noneLabel }, ...options] : options;
  const selected = all.find((o) => o.id === value);
  const [text, setText] = useState(selected?.label ?? '');
  const [typing, setTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const items = typing ? filterOptions(all, text, 100) : all;
  const { active, setActive, onKey } = useListKeys(items.length, open, setOpen);

  // Keep the box showing the chosen option when it changes from outside or the list loads.
  useEffect(() => {
    if (!typing) setText(selected?.label ?? '');
  }, [selected?.label, typing]);

  const pick = (o: ComboOption) => {
    onChange(o.id);
    setText(o.label);
    setTyping(false);
    setOpen(false);
  };

  return (
    <div className="combo">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="combo-picker"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        required={required}
        onChange={(e) => {
          setText(e.target.value);
          setTyping(true);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setTyping(false);
          setText(selected?.label ?? '');
        }}
        onKeyDown={(e) => onKey(e, (i) => pick(items[i]!))}
      />
      {open && !disabled && (
        <OptionList listId={listId} items={items} active={active} query={typing ? text : ''} onPick={pick} onHover={setActive} />
      )}
    </div>
  );
}

/** Employees as picker options: name, then code · designation · department. */
export function employeeOptions(
  rows: { id?: string; employee_id?: string; full_name: string; employee_code?: string; designation?: string; department_name?: string | null }[],
): ComboOption[] {
  return rows.map((e) => ({
    id: String(e.id ?? e.employee_id),
    label: e.full_name,
    detail: [e.employee_code, e.designation, e.department_name].filter(Boolean).join(' · '),
  }));
}
