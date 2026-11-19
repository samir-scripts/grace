import type { UnlistenFn } from '@tauri-apps/api/event';
import type { UiStyle, WindowMaterialStatus } from '$lib/types';
import { onWindowMaterialChanged, setWindowMaterialAllowed } from '$lib/ipc';
import { settings } from '$lib/stores/settings';

/** One root-owned lifecycle; native capability is never a saved preference. */
export function initWindowMaterial(): { ready: Promise<void>; destroy(): void } {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)');
  const forced = window.matchMedia('(forced-colors: active)');
  const cleanups: UnlistenFn[] = [];
  let destroyed = false;
  let listening = false;
  let style: UiStyle | undefined;
  let key: string | undefined;
  let generation = 0;
  let acknowledged = false;
  let latest: WindowMaterialStatus = { active: false, revision: 0 };
  let writes = Promise.resolve();
  root.dataset.windowMaterial = 'opaque';

  function paint() {
    root.dataset.windowMaterial = !destroyed && acknowledged && style === 'glass'
      && !reduced.matches && !forced.matches && latest.active ? 'frosted' : 'opaque';
  }

  function receive(status: WindowMaterialStatus) {
    if (destroyed || status.revision < latest.revision) return;
    latest = status;
    paint();
  }

  function refresh() {
    const allowed = !reduced.matches && !forced.matches;
    const nextKey = `${style}:${allowed}`;
    if (nextKey === key) return;
    key = nextKey;
    const current = ++generation;
    acknowledged = false;
    paint();
    if (!listening) return;
    writes = writes.then(async () => {
      if (destroyed || current !== generation) return;
      try {
        const status = await setWindowMaterialAllowed(allowed);
        if (destroyed || current !== generation) return;
        receive(status);
        acknowledged = true;
        paint();
      } catch (error) {
        if (destroyed || current !== generation) return;
        acknowledged = false;
        paint();
        console.warn('[appearance] native material unavailable:', error);
      }
    });
  }

  const ready = (async () => {
    try {
      const unlisten = await onWindowMaterialChanged(receive);
      if (destroyed) {
        unlisten();
        return;
      }
      cleanups.push(unlisten);
      listening = true;
      cleanups.push(settings.subscribe(value => {
        if (style === value.ui_style) return;
        style = value.ui_style;
        refresh();
      }));
      for (const media of [reduced, forced]) {
        media.addEventListener('change', refresh);
        cleanups.push(() => media.removeEventListener('change', refresh));
      }
      while (!destroyed) {
        const pending = writes;
        await pending;
        if (pending === writes) break;
      }
    } catch (error) {
      acknowledged = false;
      paint();
      console.warn('[appearance] native material initialization unavailable:', error);
    }
  })();

  return {
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listening = false;
      generation++;
      acknowledged = false;
      paint();
      for (const cleanup of cleanups) cleanup();
      writes = writes.then(() => setWindowMaterialAllowed(false)).then(() => {}).catch(error => {
        console.warn('[appearance] native material cleanup unavailable:', error);
      });
    },
  };
}
