/** Small hand-drawn style icons (inline SVG, inherit `currentColor`). */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  robot: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5M3 13v2M21 13v2"/>'),
  duo: svg('<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.2c.6-.2 1.3-.2 2-.2 2.3 0 4 1.5 4.5 4.5"/>'),
  phones: svg('<rect x="2.5" y="5" width="8" height="14" rx="2"/><rect x="13.5" y="5" width="8" height="14" rx="2"/><path d="M6.5 16h.01M17.5 16h.01M10.8 9.5h2.4M10.8 12h2.4"/>'),
  book: svg('<path d="M4 5.5c2.5-1 5-1 8 1 3-2 5.5-2 8-1V19c-2.5-1-5-1-8 1-3-2-5.5-2-8-1z"/><path d="M12 6.5V20"/>'),
  chart: svg('<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6" width="3" height="11" rx="1"/><rect x="15.5" y="13" width="3" height="4" rx="1"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/><circle cx="12" cy="12" r="7"/>'),
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  share: svg('<circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.8 10.9l6.4-3.3M8.8 13.1l6.4 3.3"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>'),
  home: svg('<path d="M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5M10 19v-5h4v5"/>'),
  redo: svg('<path d="M19 12a7 7 0 1 1-2.1-5M19 4.5V9h-4.5"/>'),
  door: svg('<path d="M13 4H6v16h7M10 12h10M16.5 8.5L20 12l-3.5 3.5"/>')
} as const;

export type IconName = keyof typeof ICONS;

/** Replaces every `<i data-icon="name">` placeholder with its SVG. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon as IconName;
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}
