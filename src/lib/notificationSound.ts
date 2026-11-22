/** Som curto de "nova venda", gerado com Web Audio (sem arquivo de áudio). */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let listenersAdded = false;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Navegadores móveis só liberam áudio depois de um gesto do usuário. Registra
 * uma liberação única (toque/tecla) e também tenta retomar um contexto suspenso.
 */
export function unlockNotificationAudio(): void {
  if (typeof window === "undefined" || listenersAdded) return;
  listenersAdded = true;

  const unlock = () => {
    const audio = context();
    if (audio?.state === "suspended") void audio.resume();
  };

  unlock();
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

/** Toque duplo suave: A5 + D6. Best-effort — nunca lança erro. */
export function playNotificationSound(): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();

  const start = audio.currentTime + 0.01;
  for (const [index, frequency] of [880, 1174.66].entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const at = start + index * 0.16;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);

    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.32);
  }
}
