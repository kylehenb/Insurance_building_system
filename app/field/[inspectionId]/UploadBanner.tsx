'use client'

// The big bar across the top of the field app while photos are being saved
// and uploaded: red "don't leave this screen" until every photo is on the
// server, then green "all uploaded — safe to leave". It sits over the header
// so it can't be missed.

export interface UploadBannerProps {
  total: number
  saved: number
  uploaded: number
  failed: number
  busy: boolean
  online: boolean
  /** Show the green "done" state */
  done: boolean
  onDismissDone: () => void
  onRetry: () => void
}

export function UploadBanner({ total, saved, uploaded, failed, busy, online, done, onDismissDone, onRetry }: UploadBannerProps) {
  if (busy) {
    const preparing = saved < total
    const pct = total ? Math.round((uploaded / total) * 100) : 0
    return (
      <div className={`fa-upbar ${online ? 'busy' : 'offline'}`} role="status" aria-live="polite">
        <div className="fa-upbar-title">{online ? '⚠ Don’t leave this screen' : 'No connection'}</div>
        <div className="fa-upbar-count">
          {preparing ? `Preparing photos · ${saved} of ${total}` : `Uploading photos · ${uploaded} of ${total}`}
        </div>
        <div className="fa-upbar-track"><div className="fa-upbar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="fa-upbar-note">
          {!online
            ? 'Your photos are saved on this phone and will upload when you’re back online.'
            : preparing
              ? 'Keep Safari open until this turns green. Leaving now can lose photos still being prepared.'
              : 'Keep Safari open until this turns green. All photos are saved on this phone — if you have to leave, uploading carries on when you come back.'}
        </div>
      </div>
    )
  }

  if (failed > 0) {
    return (
      <div className="fa-upbar failed" role="alert">
        <div className="fa-upbar-title">{failed} photo{failed === 1 ? '' : 's'} didn’t upload</div>
        <div className="fa-upbar-note">Check your connection, then try again. The other photos are uploaded.</div>
        <button type="button" className="fa-upbar-btn" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  if (done && total > 0) {
    return (
      <div className="fa-upbar done" role="status" aria-live="polite">
        <div className="fa-upbar-title">✓ All {total} photos uploaded</div>
        <div className="fa-upbar-note">Safe to leave this screen. The photos are being labelled on the server.</div>
        <button type="button" className="fa-upbar-btn" onClick={onDismissDone}>OK</button>
      </div>
    )
  }

  return null
}
