import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandaloneDisplay = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA(installBtn: HTMLButtonElement | null, toast: (msg: string) => void): void {
  const netBadge = document.getElementById('net-status');
  const updateNetUI = () => {
    if (!netBadge) return;
    netBadge.textContent = navigator.onLine ? '🟢 En ligne' : '📴 Hors-ligne';
    netBadge.classList.toggle('offline', !navigator.onLine);
  };
  window.addEventListener('online', updateNetUI);
  window.addEventListener('offline', updateNetUI);
  updateNetUI();

  // The single-file build runs from file:// or any host: no service worker there.
  if (__STANDALONE__ || !('serviceWorker' in navigator)) return;

  registerSW({
    immediate: true,
    onOfflineReady: () => toast('✔ Prêt à jouer hors-ligne'),
  });

  if (isStandaloneDisplay()) return;

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installBtn?.classList.remove('hidden-el');
  });
  window.addEventListener('appinstalled', () => {
    installBtn?.classList.add('hidden-el');
    deferredPrompt = null;
  });

  // iOS Safari has no install prompt: explain the manual way instead.
  if (isIOS()) installBtn?.classList.remove('hidden-el');

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) {
      if (isIOS()) toast('Sur iPhone : bouton Partager ⬆️ puis « Sur l’écran d’accueil ».');
      return;
    }
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.classList.add('hidden-el');
    deferredPrompt = null;
  });
}
