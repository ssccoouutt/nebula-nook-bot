# Live persistence investigation

## Live Koyeb dashboard

Source: https://cognitive-quintilla-techzone3228-89a97258.koyeb.app/

On 2026-08-17, the live page opened with title `ToolsMania` but the initial browser viewport was completely blank and exposed no interactive elements. The user reports that the dashboard, when rendered, shows the older counts of 44 users, 5 orders, and 2 active products while Google Drive contains newer exports with 45 users, 7 orders, and 3 product stock files.

## Supplied Google Drive folder

Source: https://drive.google.com/drive/folders/1WGJYXU1FsC1V7YOeDPlKvkKCMKPpclzl

The authenticated browser reached a folder titled `Nebula Nook Bot`. Its visible root contains three subfolders: `exports`, `metadata`, and `snapshots`. All three display a modified date of 14 August in the browser locale. This confirms the supplied folder is structured as the app expects, but does not yet prove which folder/file IDs the live Koyeb process is using.

## Live Koyeb health endpoint

Source: https://cognitive-quintilla-techzone3228-89a97258.koyeb.app/api/telegram/webhook/health

The live runtime reports `ok: true`, `active: true`, `runtime: koyeb`, bot `Toolsmania_bot` (ID 8611485733), the expected Koyeb webhook URL, and `pending_update_count: 0`. This confirms the bot process and webhook are active, but the endpoint currently exposes no database counts, Drive folder ID, restore source, or deployed version, so it cannot explain the stale dashboard state.

## Live build comparison

The current repository is at commit `3467f9ae6c2efe532849594f6bf514abb997f788` and its production build uses a different frontend asset hash than the live Koyeb site. The live HTML serves `/assets/index-B63W4akG.js`; the current local build generated `/assets/index-CTglsjT_.js` for JavaScript and `/assets/index-C3TF3lsU.css` for CSS. Therefore the live Koyeb domain is serving an older build than the current repository checkpoint.

Opening `https://app.koyeb.com/` in the browser produced a blank page with no visible controls, so the Koyeb service configuration could not be inspected from the available session.

## GitHub source verification

The connected GitHub repository `ssccoouutt/nebula-nook-bot` has default branch `main`, and `user_github` reports commit `3467f9ae6c2efe532849594f6bf514abb997f788` at `refs/heads/main`. GitHub was updated at 06:51 UTC. The live Koyeb asset mismatch therefore indicates Koyeb is not building the current `main` revision (or is serving an older deployment), not that the current repository failed to sync.

## Redeploy recheck

After the user asked to check again, the live Koyeb domain still serves `/assets/index-B63W4akG.js`; the health endpoint remains active with the expected Toolsmania_bot identity and zero pending Telegram updates. The repository remains at commit `3467f9a`. No live build change occurred, so the redeploy did not deploy the current GitHub main revision.

## Koyeb console recheck

The Koyeb console at `https://app.koyeb.com/` was opened and waited on again. It remains a blank page with only the Intercom messenger control visible; no account, project, service, deployment, or repository controls are exposed in this browser session. The logged-in Koyeb service cannot be operated from this session without the console becoming available or an API/service-specific link being provided.
