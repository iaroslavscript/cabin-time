import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { CabinAudio } from './audio.ts';
import { MovingMap, flightsFor, snapshotDate } from './ife/display.ts';
import { REGIONS, REGION_NAMES } from './ife/regions.ts';
import { parsePrefs, type Prefs } from './prefs.ts';
import {
  FAN_LEVEL_NAMES,
  FAN_LEVELS,
  SEATS,
  cycleFan,
  parseState,
  setAim,
  toggleCall,
  toggleLight,
  type Aim,
  type Aimable,
  type PanelState,
  type Seat,
} from './state.ts';

declare const __APP_VERSION__: string;

const STORAGE_KEY = 'cabin-panel-v1';
const PREFS_KEY = 'cabin-prefs-v1';

const $ = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

const loadState = (): PanelState => {
  try {
    return parseState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseState(null);
  }
};

const saveState = (s: PanelState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); the panel still works.
  }
};

const loadPrefs = (): Prefs => {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
};

/** How far a lamp or nozzle can swivel away from straight down. */
const MAX_TILT_DEG = 38;

const audio = new CabinAudio();
let state = loadState();
let prefs = loadPrefs();

/** The seat letter printed on the panel for a position (A/B/C = left/middle/right). */
const letter = (seat: Seat): string => prefs.seats.charAt(SEATS.indexOf(seat));

const lightCell = (seat: Seat): HTMLElement => $(`.light-cell[data-seat="${seat}"]`);
const gasper = (seat: Seat): HTMLButtonElement => $(`.fans [data-seat="${seat}"] .gasper`);
const callBtn = $<HTMLButtonElement>('#call');
const psu = $<HTMLElement>('.psu');

/** Exposes an aim as CSS variables: offset (--ax, --ay), direction and the cosine of the tilt. */
const applyAim = (el: HTMLElement, [x, y]: Aim): void => {
  const tilt = (Math.hypot(x, y) * MAX_TILT_DEG * Math.PI) / 180;
  el.style.setProperty('--ax', String(x));
  el.style.setProperty('--ay', String(y));
  el.style.setProperty('--dir', `${Math.round((Math.atan2(y, x) * 180) / Math.PI)}deg`);
  el.style.setProperty('--squash', Math.cos(tilt).toFixed(3));
};

/** Below this tilt a lit lamp shines straight into your eyes. */
const GLARE_TILT = 0.4;

/** 0 (pointing away) … 1 (pointing straight at you), eased so it ramps up sharply near the centre. */
const glare = ([x, y]: Aim): number => {
  const t = Math.max(0, 1 - Math.hypot(x, y) / GLARE_TILT);
  return t * t * (3 - 2 * t);
};

const render = (): void => {
  for (const seat of SEATS) {
    const on = state.lights[seat];
    const cell = lightCell(seat);
    cell.classList.toggle('on', on);
    const btn = cell.querySelector('.light-btn');
    btn?.setAttribute('aria-pressed', String(on));
    btn?.setAttribute('aria-label', `Reading light ${letter(seat)}`);
    applyAim(cell, state.aim.lights[seat]);
    cell.style.setProperty('--glare', on ? glare(state.aim.lights[seat]).toFixed(3) : '0');

    const level = state.fans[seat];
    const vent = gasper(seat);
    vent.dataset.level = String(level);
    vent.setAttribute('aria-label', `Air vent ${letter(seat)}: ${FAN_LEVEL_NAMES[level]}`);
    applyAim(vent, state.aim.fans[seat]);
  }
  $('.row-no').textContent = String(prefs.row);
  $('.seat-letters').replaceChildren(
    ...SEATS.map((seat) => Object.assign(document.createElement('span'), { textContent: letter(seat) })),
  );
  psu.setAttribute('aria-label', `Passenger service unit, row ${prefs.row}`);
  callBtn.setAttribute('aria-pressed', String(state.call));
  psu.classList.toggle('calling', state.call);

  const maxFlow = SEATS.length * (FAN_LEVELS.length - 1);
  audio.setFlow(SEATS.reduce((sum, seat) => sum + state.fans[seat], 0) / maxFlow);
};

const update = (next: PanelState): void => {
  state = next;
  saveState(state);
  render();
};

const feedback = (): void => {
  audio.click();
  navigator.vibrate?.(12);
};

// Mobile browsers only allow audio after a user gesture.
document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
document.addEventListener('keydown', () => audio.unlock(), { capture: true });
// Long-press on a panel should feel like a button, not open a context menu.
document.addEventListener('contextmenu', (e) => e.preventDefault());

/**
 * Dragging a lamp or nozzle swivels it toward the finger, like the ball joints on a real panel.
 * A short tap still toggles it.
 */
const makeAimable = (el: HTMLElement, kind: Aimable, seat: Seat): void => {
  let start: { x: number; y: number } | undefined;
  let aiming = false;
  let swallowClick = false;
  el.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    aiming = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!aiming && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
    if (!aiming) navigator.vibrate?.(6);
    aiming = true;
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    state = setAim(state, kind, seat, [
      (e.clientX - r.left - radius) / radius,
      (e.clientY - r.top - r.height / 2) / radius,
    ]);
    render();
  });
  const end = (): void => {
    if (aiming) {
      update(state);
      swallowClick = true;
    }
    start = undefined;
    aiming = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
};

for (const seat of SEATS) {
  const cell = lightCell(seat);
  makeAimable($(`.light-cell[data-seat="${seat}"] .lamp`), 'lights', seat);
  makeAimable(gasper(seat), 'fans', seat);
  const toggle = (): void => {
    audio.unlock();
    feedback();
    update(toggleLight(state, seat));
  };
  cell.querySelector('.light-btn')?.addEventListener('click', toggle);

  gasper(seat).addEventListener('click', () => {
    audio.unlock();
    feedback();
    update(cycleFan(state, seat));
  });
}

callBtn.addEventListener('click', () => {
  audio.unlock();
  navigator.vibrate?.(state.call ? 12 : [20, 60, 20]);
  update(toggleCall(state));
  if (state.call) void audio.playChime();
  else audio.click();
});

const about = $<HTMLDialogElement>('#about');
$('#app-version').textContent = __APP_VERSION__;
$('#info').addEventListener('click', () => about.showModal());
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});

render();

// ---------- Moving map (IFE) ----------

const ife = $<HTMLButtonElement>('.ife');
const movingMap = new MovingMap(ife, prefs);

const applyPrefs = (): void => {
  render();
  psu.classList.toggle('no-ife', !prefs.ife);
  if (!prefs.ife) setExpanded(false);
  movingMap.setPrefs(prefs);
};

const setExpanded = (expanded: boolean): void => {
  if (expanded === psu.classList.contains('ife-open')) return;
  const apply = (): void => {
    psu.classList.toggle('ife-open', expanded);
    ife.setAttribute('aria-expanded', String(expanded));
    ife.setAttribute('aria-label', `Moving map display, tap to ${expanded ? 'shrink' : 'enlarge'}`);
    movingMap.render();
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduced) document.startViewTransition(apply);
  else apply();
};

// The Android back button shrinks the enlarged display instead of leaving the app.
const toggleExpanded = (): void => {
  if (psu.classList.contains('ife-open')) {
    if ((history.state as { ife?: boolean } | null)?.ife) history.back();
    else setExpanded(false);
  } else {
    history.pushState({ ife: true }, '');
    setExpanded(true);
  }
};
// After a reload the display starts small, so drop a leftover "enlarged" history entry.
if ((history.state as { ife?: boolean } | null)?.ife) history.replaceState(null, '');
window.addEventListener('popstate', () => setExpanded(!!(history.state as { ife?: boolean } | null)?.ife));

ife.addEventListener('click', () => {
  feedback();
  toggleExpanded();
});
$('.ife-scrim').addEventListener('click', toggleExpanded);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && psu.classList.contains('ife-open')) toggleExpanded();
});

const prefsDialog = $<HTMLDialogElement>('#prefs');
const prefsForm = $<HTMLFormElement>('.prefs-form');
const regionSelect = $<HTMLSelectElement>('select[name="region"]');
const rowInput = $<HTMLInputElement>('input[name="row"]');
const seatsSelect = $<HTMLSelectElement>('select[name="seats"]');
for (const region of REGIONS) {
  regionSelect.add(new Option(`${REGION_NAMES[region]} — ${flightsFor({ region }).length} flights`, region));
}

const showCurrentFlight = (): void => {
  $('#current-flight').textContent = movingMap.summary;
};

const readForm = (): Prefs => {
  const data = new FormData(prefsForm);
  return parsePrefs(
    JSON.stringify({
      region: data.get('region'),
      units: data.get('units'),
      clock: data.get('clock'),
      ife: data.has('ife'),
      row: Number(data.get('row')),
      seats: data.get('seats'),
    }),
  );
};

prefsForm.addEventListener('change', () => {
  // An invalid row keeps the previous one rather than jumping back to the default.
  if (!rowInput.checkValidity()) return;
  prefs = readForm();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences just won't persist.
  }
  applyPrefs();
  showCurrentFlight();
});

$('#settings').addEventListener('click', () => {
  regionSelect.value = prefs.region;
  rowInput.value = String(prefs.row);
  seatsSelect.value = prefs.seats;
  for (const name of ['units', 'clock'] as const) {
    prefsForm.querySelector<HTMLInputElement>(`input[name="${name}"][value="${prefs[name]}"]`)!.checked = true;
  }
  prefsForm.querySelector<HTMLInputElement>('input[name="ife"]')!.checked = prefs.ife;
  showCurrentFlight();
  prefsDialog.showModal();
});
$('#next-flight').addEventListener('click', () => {
  movingMap.newFlight();
  showCurrentFlight();
});
prefsDialog.addEventListener('click', (e) => {
  if (e.target === prefsDialog) prefsDialog.close();
});

$('#snapshot-date').textContent = snapshotDate();
applyPrefs();

registerSW({ immediate: true });
