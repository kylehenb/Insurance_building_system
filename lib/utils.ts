import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatEstHours(hours: number | null | undefined): string {
  if (hours == null) return '—'
  return hours.toFixed(2)
}
