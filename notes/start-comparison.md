# Qamify vs Nebula Nook `/start` comparison

The fresh Telegram Web view shows that Qamify’s perceived “coloured buttons” are client-rendered Telegram inline keyboards; a bot cannot directly set arbitrary button colors through the standard Bot API. Qamify differentiates sections using emoji-rich labels, dense status/profile information, and visually grouped actions. Its observed public surfaces include masked identity details in announcements, product/status context, and prominent emoji-led actions.

Nebula Nook currently exposes the core actions—Freebies, Shop, Wallet, Orders, Profile, and Support—but its start response is more minimal and less information-dense. The improvement opportunity is to add a clear user summary (display name, masked username/ID where appropriate, tier, wallet, referral count, access state), a welcome/status header, and grouped emoji-labeled buttons. Button color itself is a Telegram-client presentation concern and cannot be guaranteed by bot code.

## Direct live verification

On 2026-08-12, a fresh `/start` was sent to @NebulaNook4827_bot in Telegram Web. The reply visibly showed: “Welcome back, Mr!”, username “No username”, tier “Bronze”, wallet “$10.00”, referrals “0”, and “Membership active”, followed by grouped inline actions. Telegram Web rendered those buttons in its standard client style; arbitrary custom button colors were not exposed, confirming that button color is controlled by Telegram’s client/theme rather than the Bot API.
