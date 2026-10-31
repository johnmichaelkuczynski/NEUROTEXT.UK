const RESET_MARKER = "neurotext-reset-current-function";

// Reload the current URL, never the app root. On return, show the function,
// not the navigation list above it.
export function clearWritingPage(storageKey: string) {
  sessionStorage.removeItem(storageKey);
  sessionStorage.removeItem(`${storageKey}-rewrite-instructions`);
  sessionStorage.removeItem(`${storageKey}-before-output-rewrite`);
  sessionStorage.setItem(RESET_MARKER, window.location.pathname);
  window.location.reload();
}

export function restoreClearedFunction() {
  try {
    if (sessionStorage.getItem(RESET_MARKER) !== window.location.pathname) return;
    sessionStorage.removeItem(RESET_MARKER);
    requestAnimationFrame(() => {
      const heading = document.querySelector("main h1");
      heading?.scrollIntoView({ block: "start" });
      document.querySelector<HTMLTextAreaElement>("main textarea")?.focus({ preventScroll: true });
    });
  } catch { /* Blocked storage must not break page rendering. */ }
}
