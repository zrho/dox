import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/** Compose variants and let callers override conflicting Tailwind utilities. */
export function cn(...classes: ClassValue[]) {
  return twMerge(clsx(classes));
}
