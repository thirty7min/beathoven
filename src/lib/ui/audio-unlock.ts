// Browsers only allow audible playback after a gesture, so the first gesture anywhere unlocks audio for later autoplay.

const media = new Set<HTMLMediaElement>();
const primed = new WeakSet<HTMLMediaElement>();
const listeners = new Set<() => void>();
let blocked = false;
let context: AudioContext | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeAudioBlocked(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAudioBlocked() {
  return blocked;
}

export function reportAudioBlocked() {
  if (blocked) return;
  blocked = true;
  emit();
}

export function registerMedia(element: HTMLMediaElement) {
  media.add(element);
  return () => {
    media.delete(element);
  };
}

function prime(element: HTMLMediaElement) {
  if (primed.has(element) || !element.paused || !element.src) return;
  primed.add(element);
  const wasMuted = element.muted;
  element.muted = true;
  element.play().then(
    () => {
      element.pause();
      element.muted = wasMuted;
    },
    () => {
      primed.delete(element);
      element.muted = wasMuted;
    },
  );
}

export function sharedAudioContext(): AudioContext | null {
  if (context) return context;
  if (typeof AudioContext === "undefined") return null;
  try {
    const created = new AudioContext();
    created.addEventListener("statechange", () => {
      if (created.state === "running" && blocked) {
        blocked = false;
        emit();
      }
    });
    context = created;
  } catch {
    return null;
  }
  return context;
}

export function unlockAudio() {
  const shared = sharedAudioContext();
  if (shared?.state === "suspended") void shared.resume();
  for (const element of media) prime(element);
  if (blocked) {
    blocked = false;
    emit();
  }
}

export function installAudioUnlock() {
  const onGesture = () => unlockAudio();
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
  return () => {
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
  };
}

export function shouldShowResumePill({ blocked, wantsAudio, muted }: { blocked: boolean; wantsAudio: boolean; muted: boolean }): boolean {
  return blocked && wantsAudio && !muted;
}
