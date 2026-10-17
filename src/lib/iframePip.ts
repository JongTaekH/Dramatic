export interface IframePipSession {
  window: Window;
  close: () => void;
}

interface PipCallbacks {
  beforeMove?: () => void;
  onMove?: (pipWindow: Window) => void | Promise<void>;
  onResize?: (pipWindow: Window) => void;
  onSubtitleScale?: (delta: number) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: () => void;
}

export async function openIframePip(player: HTMLElement, callbacks: PipCallbacks): Promise<IframePipSession> {
  const source = player.ownerDocument;
  const api = (source.defaultView as (Window & {
    documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
  }) | null)?.documentPictureInPicture;
  if (!api) throw new Error('Document PiP is unavailable');
  const width = Math.min(960, Math.max(480, Math.round(player.getBoundingClientRect().width || 854)));
  const pip = await api.requestWindow({ width, height: Math.round(width * 9 / 16) });
  const placeholder = source.createElement('div');
  placeholder.dataset.iframePipPlaceholder = '';
  placeholder.style.cssText = 'aspect-ratio:16/9;display:grid;place-items:center;background:#090d16;color:#c084fc;border-radius:16px';
  const closeButton = source.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '자막 포함 PIP 재생 중 · 원래 화면으로 돌아오기';
  placeholder.appendChild(closeButton);
  const pipControls = pip.document.createElement('div');
  pipControls.dataset.iframePipControls = '';
  pipControls.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;display:flex;flex-direction:row;align-items:center;gap:6px;padding:5px;border-radius:999px;background:rgba(0,0,0,.7);font:600 12px system-ui;color:#fff;white-space:nowrap;pointer-events:auto;isolation:isolate';
  const smaller = pip.document.createElement('button');
  smaller.type = 'button';
  smaller.setAttribute('aria-label', '자막 작게');
  smaller.textContent = '자막 −';
  const larger = pip.document.createElement('button');
  larger.type = 'button';
  larger.setAttribute('aria-label', '자막 크게');
  larger.textContent = '자막 +';
  [smaller, larger].forEach(button => {
    button.style.cssText = 'position:relative;display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-width:56px;height:30px;border:0;border-radius:999px;padding:6px 9px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer;white-space:nowrap';
  });
  smaller.addEventListener('click', () => callbacks.onSubtitleScale?.(-1));
  larger.addEventListener('click', () => callbacks.onSubtitleScale?.(1));
  pipControls.append(smaller, larger);
  let restored = false;
  let pollTimer: number | undefined;
  const handleResize = () => callbacks.onResize?.(pip);
  const restore = () => {
    if (restored) return;
    restored = true;
    if (pollTimer !== undefined) pip.clearInterval(pollTimer);
    pip.removeEventListener('message', forwardMessage);
    pip.removeEventListener('pagehide', restore);
    pip.removeEventListener('resize', handleResize);
    pipControls.remove();
    if (placeholder.parentNode) {
      if (player.ownerDocument !== source) callbacks.beforeMove?.();
      placeholder.parentNode.replaceChild(player, placeholder);
    }
    player.removeAttribute('data-iframe-pip');
    callbacks.onClose?.();
  };
  const close = () => {
    restore();
    if (!pip.closed) pip.close();
  };
  const forwardMessage = (event: MessageEvent) => callbacks.onMessage?.(event);
  closeButton.addEventListener('click', close);
  pip.addEventListener('pagehide', restore, { once: true });
  pip.addEventListener('message', forwardMessage);
  try {
    if (!player.isConnected) throw new Error('Player was removed');
    for (const node of source.querySelectorAll('style, link[rel="stylesheet"]')) {
      pip.document.head.appendChild(node.cloneNode(true));
    }
    const style = pip.document.createElement('style');
    style.textContent = `
      html, body { margin:0!important; padding:0!important; width:100%; height:100%; background:#000; overflow:hidden; }
      [data-iframe-pip] { position:relative!important; inset:auto!important; width:100vw!important; height:100vh!important; aspect-ratio:auto!important; border:0!important; border-radius:0!important; }
    `;
    pip.document.head.appendChild(style);
    player.parentNode!.insertBefore(placeholder, player);
    callbacks.beforeMove?.();
    player.dataset.iframePip = '';
    pip.document.body.appendChild(player);
    pip.document.body.appendChild(pipControls);
    pollTimer = pip.setInterval(() => {
      player.querySelector('iframe')?.contentWindow?.postMessage({ command: 'getTime' }, '*');
    }, 100);
    pip.addEventListener('resize', handleResize);
    await callbacks.onMove?.(pip);
    return { window: pip, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function createIframePlaybackRestore(now: () => number = Date.now) {
  let pending: { time: number; deadline: number; nextTry: number } | null = null;
  return {
    queue(time: number) {
      if (pending) return;
      if (Number.isFinite(time) && time > 0) pending = { time, deadline: now() + 30000, nextTry: 0 };
    },
    accept(time: number, duration: number, seek: (target: number) => void) {
      if (!pending) return true;
      if (Math.abs(time - pending.time) < 2 || now() >= pending.deadline) {
        pending = null;
        return true;
      }
      if (duration > 0 && now() >= pending.nextTry) {
        seek(Math.min(pending.time, Math.max(0, duration - 0.1)));
        pending.nextTry = now() + 500;
      }
      return false;
    },
  };
}
