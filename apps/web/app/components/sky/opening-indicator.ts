/**
 * The status message shown while a travel waits for the next depth to arrive. It is a plain
 * DOM node outside React: the depth that started the travel unmounts when the navigation
 * lands, and the message must outlive its renders until then.
 */
const ID = 'sky-opening';
/** How long the "could not open" message stays before it clears itself. */
const FAILED_VISIBLE = 5000;

let failedTimer = 0;

function region(): HTMLElement {
  let element = document.getElementById(ID);
  if (!element) {
    element = document.createElement('div');
    element.id = ID;
    element.className = 'sky-opening sky-scope';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    document.body.append(element);
  }
  return element;
}

function say(text: string, failed: boolean) {
  const element = region();
  element.dataset.failed = String(failed);
  element.replaceChildren();
  if (!failed) {
    const star = document.createElement('i');
    star.className = 'sky-opening-star';
    star.setAttribute('aria-hidden', 'true');
    element.append(star);
  }
  element.append(document.createTextNode(text));
}

export function showOpening(label?: string) {
  window.clearTimeout(failedTimer);
  say(label ? `Abriendo ${label}…` : 'Abriendo…', false);
}

export function showOpeningFailed() {
  window.clearTimeout(failedTimer);
  say('No se ha podido abrir. Toca de nuevo para reintentar.', true);
  failedTimer = window.setTimeout(hideOpening, FAILED_VISIBLE);
}

export function hideOpening() {
  window.clearTimeout(failedTimer);
  document.getElementById(ID)?.remove();
}
