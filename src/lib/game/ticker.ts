export function startTicker(intervalMs: number, onTick: () => void): () => void {
  const worker = tickWorker(intervalMs);
  if (worker) {
    worker.instance.onmessage = onTick;
    return () => {
      worker.instance.terminate();
      URL.revokeObjectURL(worker.url);
    };
  }
  const id = setInterval(onTick, intervalMs);
  return () => clearInterval(id);
}

// Worker timers dodge Chrome's background-tab throttling (one wake a minute), which would outlast the server's idle grace.
function tickWorker(intervalMs: number): { instance: Worker; url: string } | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") return null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${intervalMs});`], { type: "text/javascript" }));
    return { instance: new Worker(url), url };
  } catch {
    if (url) URL.revokeObjectURL(url);
    return null;
  }
}
