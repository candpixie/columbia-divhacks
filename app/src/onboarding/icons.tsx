// SVG icons from the Reach NYC prototype
import type { StepId } from './constants'

const STEP_ICON: Record<StepId, string> = {
  budget: '<path d="M8 1.5v13M11 4.5C10.3 3.6 9.3 3.2 8 3.2c-1.8 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.3-3 2.3-1.4 0-2.6-.5-3.2-1.5"/>',
  places: '<path d="M8 14.5s5-4.3 5-8.3A5 5 0 0 0 3 6.2c0 4 5 8.3 5 8.3Z"/><circle cx="8" cy="6.2" r="1.7"/>',
  rank: '<path d="M2 4h8M2 8h6M2 12h4M12 3v10M10 11l2 2 2-2"/>',
  invite: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 14c.4-2.6 2.2-4 4.5-4s4.1 1.4 4.5 4"/><path d="M12 5v4M10 7h4"/>',
}

const PLACE_ICON: Record<string, string> = {
  Work: '<rect x="2" y="5" width="12" height="8.5" rx="1.5"/><path d="M5.5 5V3.5A1 1 0 0 1 6.5 2.5h3a1 1 0 0 1 1 1V5M2 9h12"/>',
  School: '<path d="M1.5 6 8 3l6.5 3L8 9Z"/><path d="M4 7.3v3.4c1 1 2.5 1.6 4 1.6s3-.6 4-1.6V7.3"/>',
  Family: '<path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5Z"/><path d="M6.5 13.5V10h3v3.5"/>',
  Partner: '<path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5Z"/>',
  Gym: '<path d="M1.5 8h13M4 5v6M12 5v6M2.5 6.5v3M13.5 6.5v3"/>',
  Friends: '<circle cx="5.5" cy="5.5" r="2"/><circle cx="11" cy="6" r="1.7"/><path d="M1.5 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5M10 9.6c1.9 0 3.2 1.1 3.6 3.1"/>',
  other: '<path d="M8 14.5s5-4.3 5-8.3A5 5 0 0 0 3 6.2c0 4 5 8.3 5 8.3Z"/><circle cx="8" cy="6.2" r="1.7"/>',
}

const svg16 = (inner: string) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />
)

export const StepIcon = ({ id }: { id: StepId }) => svg16(STEP_ICON[id])
export const PlaceIcon = ({ label }: { label: string }) => svg16(PLACE_ICON[label] ?? PLACE_ICON.other)

export const Logo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </svg>
)

export const Mark = () => (
  <div className="mark">
    <Logo />
    Rentdezvous
  </div>
)

export const Arrow = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
)

export const BackArrow = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M13 8H3M7 4 3 8l4 4" />
  </svg>
)
