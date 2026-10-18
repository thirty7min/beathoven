export const REVEAL_LEAVE_DELAY_MS = 180;
export const REVEAL_TOUCH_IDLE_MS = 4_000;

export type RevealState = { hover: boolean; dragging: boolean; keyboard: boolean; touch: boolean };

export type RevealEvent =
  | { type: "hover" }
  | { type: "hoverEnd" }
  | { type: "dragStart" }
  | { type: "dragEnd" }
  | { type: "keyboardFocus" }
  | { type: "blur" }
  | { type: "touchOpen" }
  | { type: "outside" }
  | { type: "idle" };

export const initialRevealState: RevealState = { hover: false, dragging: false, keyboard: false, touch: false };

export function isRevealed(state: RevealState): boolean {
  return state.hover || state.dragging || state.keyboard || state.touch;
}

export function revealReducer(state: RevealState, event: RevealEvent): RevealState {
  switch (event.type) {
    case "hover":
      return { ...state, hover: true };
    case "hoverEnd":
      return { ...state, hover: false };
    case "dragStart":
      return { ...state, dragging: true };
    case "dragEnd":
      return { ...state, dragging: false };
    case "keyboardFocus":
      return { ...state, keyboard: true };
    case "blur":
      return { ...state, keyboard: false };
    case "touchOpen":
      return { ...state, touch: true };
    case "outside":
      return initialRevealState;
    case "idle":
      return state.dragging ? state : { ...state, touch: false };
  }
}
