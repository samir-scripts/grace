type ModalFocusOptions = { onEscape: () => void };

/** Keep keyboard focus in a mounted modal and return it when the modal closes. */
export function modalFocus(node: HTMLElement, options: ModalFocusOptions) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  queueMicrotask(() => {
    if (node.isConnected) (focusable()[0] ?? node).focus();
  });
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      options.onEscape();
    } else if (event.key === 'Tab') {
      const items = focusable();
      if (!items.length) { event.preventDefault(); node.focus(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
    }
  }
  node.addEventListener('keydown', keydown);
  return {
    update(next: ModalFocusOptions) { options = next; },
    destroy() { node.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); },
  };
}
