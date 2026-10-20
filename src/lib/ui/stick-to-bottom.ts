export const NEAR_BOTTOM_PX = 48;

export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

export function isNearBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics, threshold = NEAR_BOTTOM_PX): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function nextStuck(stuck: boolean, previousTop: number, metrics: ScrollMetrics): boolean {
  if (isNearBottom(metrics)) return true;
  return metrics.scrollTop < previousTop ? false : stuck;
}
