"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ShellBackdropContext = createContext<HTMLElement | null>(null);

export const ShellBackdropProvider = ShellBackdropContext.Provider;

export function ShellBackdrop({ children }: { children: ReactNode }) {
  const target = useContext(ShellBackdropContext);
  return target ? createPortal(children, target) : null;
}
