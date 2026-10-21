// Styles for the signer page (lib/signing/signer-page/render.ts). Plain CSS
// with hex colours and no modern-only features (no nesting, :has(), oklch,
// or flex gap), so it renders on older iOS Safari and Android browsers.
// Scoped under .sg.

export const SIGNER_CSS = `
html, body { background: #ffffff; }
.sg { color: #111111; background: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 19px; line-height: 1.6; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; min-height: 100vh; padding-bottom: 170px; }
.sg * { box-sizing: border-box; }
.sg a, .sg button, .sg label { -webkit-tap-highlight-color: rgba(0,0,0,0.08); }
.sg a { color: #0b4a8b; }
.sg-wrap { max-width: 680px; margin: 0 auto; padding: 0 16px; }

.sg-top { border-bottom: 4px solid #c9a96e; background: #ffffff; }
.sg-top .sg-wrap { display: flex; align-items: center; padding-top: 14px; padding-bottom: 12px; }
.sg-top img { height: 44px; width: auto; margin-right: 12px; }
.sg-top-name { font-weight: bold; font-size: 18px; }

.sg h1 { font-size: 28px; line-height: 1.25; margin: 24px 0 12px; }
.sg h2 { font-size: 23px; line-height: 1.3; margin: 32px 0 10px; }
.sg h3 { font-size: 19px; margin: 20px 0 6px; }
.sg p { margin: 0 0 14px; }

.sg-card { background: #f7f4ef; border: 1px solid #e3ddd3; border-radius: 12px; padding: 20px; margin: 20px 0; }
.sg-kicker { font-size: 16px; font-weight: bold; color: #5a4a2a; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
.sg-howto { margin: 6px 0 18px 0; padding-left: 26px; }
.sg-howto li { margin-bottom: 4px; }

.sg-btn { display: block; width: 100%; min-height: 58px; border-radius: 10px; border: 2px solid #111111; padding: 14px 18px; font-size: 21px; font-weight: bold; text-align: center; text-decoration: none; cursor: pointer; font-family: inherit; line-height: 1.3; -webkit-appearance: none; appearance: none; }
.sg-btn + .sg-btn { margin-top: 12px; }
.sg .sg-btn-primary { background: #111111; color: #ffffff; }
.sg .sg-btn-secondary { background: #ffffff; color: #111111; }
.sg .sg-btn-link { background: none; border: none; color: #0b4a8b; text-decoration: underline; font-size: 18px; min-height: 48px; padding: 10px 4px; width: auto; display: inline-block; font-weight: normal; }
.sg-btn:focus, .sg-sign-box:focus, .sg input:focus, .sg-style:focus-within, .sg-tab:focus-within { outline: 3px solid #0b63c4; outline-offset: 2px; }
.sg-btn[disabled] { opacity: 0.55; cursor: default; }

.sg-doc { margin-top: 8px; }
.sg-doc .sg-callout { background: #fff8e6; border-left: 5px solid #c9a96e; padding: 14px 16px; border-radius: 6px; }
.sg-details { margin: 0 0 16px; padding: 0; border-top: 1px solid #e3ddd3; }
.sg-details div { padding: 10px 0; border-bottom: 1px solid #e3ddd3; }
.sg-details dt { font-size: 16px; color: #555555; font-weight: bold; }
.sg-details dd { margin: 2px 0 0; }
.sg-list { padding-left: 28px; margin: 0 0 16px; }
.sg-list li { margin-bottom: 10px; }
.sg-room { margin: 0 0 14px; }
.sg-room h3 { background: #f7f4ef; padding: 8px 12px; border-radius: 6px; margin: 16px 0 6px; }
.sg-room ol { padding-left: 34px; margin: 0; }
.sg-room li { margin-bottom: 10px; }
.sg-qty { display: block; color: #555555; font-size: 17px; }

.sg-field { border: 3px solid #c9a96e; border-radius: 14px; padding: 18px; margin: 26px 0; background: #fffdf8; scroll-margin-top: 20px; }
.sg-field.is-current { border-color: #0b63c4; }
.sg-field.is-done { border-color: #2e7d32; }
.sg-step { font-weight: bold; color: #5a4a2a; font-size: 17px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 6px; }
.sg-field.is-done .sg-step { color: #1b5e20; }
.sg-sign-box { display: block; width: 100%; min-height: 110px; border: 3px dashed #8a7a5a; border-radius: 10px; background: #ffffff; padding: 12px; font-family: inherit; font-size: 21px; font-weight: bold; color: #111111; cursor: pointer; text-align: center; -webkit-appearance: none; appearance: none; }
.sg-field.is-done .sg-sign-box { border-style: solid; border-color: #2e7d32; }
.sg-sign-placeholder { display: block; }
.sg-sign-preview { display: none; font-weight: normal; font-size: 40px; line-height: 1.2; color: #0d1f5a; word-break: break-word; }
.sg-sign-preview img { max-width: 100%; max-height: 90px; }
.sg-field.is-done .sg-sign-placeholder { display: none; }
.sg-field.is-done .sg-sign-preview { display: block; }
.sg-sign-done { display: none; color: #1b5e20; font-weight: bold; margin-top: 8px; font-size: 17px; }
.sg-field.is-done .sg-sign-done { display: block; }
.sg-nojs-note { color: #555555; font-size: 17px; margin-top: 8px; }
.sg-js .sg-nojs-note, .sg-js .sg-nojs-only { display: none; }
.sg-js-only { display: none; }
.sg-js .sg-js-only { display: block; }
.sg-js .sg-tabs.sg-js-only { display: flex; }
.sg-js #sg-form { background: none; border: 0; padding: 0; margin: 0; }

.sg-adopt h2 { margin-top: 8px; }
.sg-tabs { display: flex; margin: 8px 0 16px; border: 2px solid #111111; border-radius: 10px; overflow: hidden; }
.sg-tab { flex: 1 1 0; position: relative; }
.sg-tab input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.sg-tab span { display: block; min-height: 54px; padding: 13px 8px; text-align: center; font-weight: bold; font-size: 19px; background: #ffffff; cursor: pointer; }
.sg-tab input:checked + span { background: #111111; color: #ffffff; }
.sg-label { display: block; font-weight: bold; margin-bottom: 6px; }
.sg-input { display: block; width: 100%; min-height: 56px; font-size: 21px; padding: 10px 14px; border: 2px solid #555555; border-radius: 8px; font-family: inherit; color: #111111; background: #ffffff; }
.sg-capacity { border: 0; margin: 18px 0 0; padding: 0; min-width: 0; }
.sg-capacity legend { padding: 0; }
.sg-choice { display: block; position: relative; border: 2px solid #c9c2b5; border-radius: 10px; margin-bottom: 10px; background: #ffffff; cursor: pointer; padding: 12px 14px 12px 52px; min-height: 56px; }
.sg-choice input { position: absolute; left: 16px; top: 16px; width: 22px; height: 22px; margin: 0; }
.sg-choice-hint { display: block; font-size: 16px; color: #555555; line-height: 1.4; margin-top: 2px; }
.sg-choice.is-checked { border-color: #111111; border-width: 3px; }
.sg-styles { margin: 16px 0 6px; }
.sg-style { display: block; position: relative; border: 2px solid #c9c2b5; border-radius: 10px; margin-bottom: 10px; background: #ffffff; cursor: pointer; }
.sg-style input { position: absolute; left: 16px; top: 50%; margin-top: -11px; width: 22px; height: 22px; }
.sg-style-sample { display: block; padding: 12px 14px 12px 52px; font-size: 36px; line-height: 1.3; min-height: 70px; color: #0d1f5a; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sg-style.is-checked { border-color: #111111; border-width: 3px; }
.sg-draw-wrap { border: 2px solid #555555; border-radius: 10px; background: #ffffff; position: relative; }
.sg-draw-wrap canvas { display: block; width: 100%; height: 200px; touch-action: none; -ms-touch-action: none; }
.sg-draw-line { position: absolute; left: 16px; right: 16px; bottom: 44px; border-bottom: 2px solid #c9c2b5; pointer-events: none; }
.sg-draw-hint { position: absolute; left: 16px; bottom: 12px; color: #777777; font-size: 16px; pointer-events: none; }
.sg-panel-draw { display: none; }
.sg-adopt.is-draw .sg-panel-type { display: none; }
.sg-adopt.is-draw .sg-panel-draw { display: block; }
.sg-error { background: #fdecea; border: 2px solid #b3261e; color: #6b130e; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-weight: bold; }
.sg-consent { font-weight: bold; font-size: 19px; margin: 0 0 12px; }

/* With script: the signature panel opens as a full-screen sheet */
.sg-js .sg-adopt { display: none; }
.sg-js .sg-adopt.is-open { display: block; position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 60; background: #ffffff; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 0 40px; }
.sg-sheet-head { display: flex; justify-content: space-between; align-items: center; }
.sg-js .sg-finish-inline { display: none; }

/* Bottom bar: always shows the one next step */
.sg-bar { display: none; }
.sg-js .sg-bar { display: block; position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; background: #ffffff; border-top: 3px solid #c9a96e; box-shadow: 0 -4px 18px rgba(0,0,0,0.12); padding: 12px 0; padding-bottom: 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
.sg-bar-progress { font-weight: bold; font-size: 17px; margin-bottom: 8px; color: #333333; }
.sg-bar .sg-consent { font-size: 17px; margin-bottom: 8px; display: none; }
.sg-bar.is-finish .sg-consent { display: block; }

.sg-overlay { display: none; }
.sg-overlay.is-open { display: block; position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 80; background: rgba(255,255,255,0.96); text-align: center; padding-top: 30vh; font-size: 24px; font-weight: bold; }
.sg-spinner { width: 54px; height: 54px; border: 6px solid #e3ddd3; border-top-color: #111111; border-radius: 50%; margin: 0 auto 18px; animation: sg-spin 0.9s linear infinite; }
@keyframes sg-spin { to { transform: rotate(360deg); } }

.sg-status { text-align: left; padding-top: 12px; }
.sg-status-icon { font-size: 54px; line-height: 1; margin: 28px 0 4px; }
.sg-contact { margin-top: 28px; padding: 18px 20px; border-radius: 12px; background: #f7f4ef; border: 1px solid #e3ddd3; }
.sg-contact a { display: inline-block; min-height: 48px; padding: 10px 0; font-weight: bold; font-size: 20px; word-break: break-all; }
.sg-foot { color: #555555; font-size: 15px; margin-top: 22px; }

@media (min-width: 700px) {
  .sg { font-size: 20px; }
  .sg h1 { font-size: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .sg-spinner { animation: none; }
}
`
