# Telegram Button-Style Investigation

## Direct Telegram Web inspection

On 2026-08-12, Telegram Web was opened with the logged-in Qamify chat and the Nebula Nook chat. In Qamify, the visible controls included `Join Channel`, `Buy Now`, quantity selectors, `Custom Quantity`, `Set Price Alert`, and `« Back to Shop`. The browser DOM rendered these as Telegram Web `<button>` elements with classes including `Button ... tiny primary ...`. The computed background for Qamify buttons was `rgba(74, 142, 58, 0.55)`, with white text and no border. The Buy Now controls also contained a custom emoji/sticker element inside the button.

Nebula Nook’s visible controls (`Freebies`, `Shop`, `Wallet`, `Orders`, `Profile`, `Support`, and `Buy`) rendered with the same Telegram Web button class family and the same computed green background `rgba(74, 142, 58, 0.55)`, white text, no border. This shows that the apparent green button styling is not evidence of a CSS stylesheet or a custom color supplied by Qamify’s message HTML; it is a Telegram client rendering style applied to the button type/style.

## Official documentation evidence

Telegram’s official Bot Buttons documentation describes `keyboardButtonStyle` with predefined `bg_primary` (dark blue), `bg_danger` (red), and `bg_success` (green) backgrounds, plus an optional custom emoji icon. The documentation says clients should render these colors according to the current theme, and only these predefined styles are available. The official page is https://core.telegram.org/api/bots/buttons.

Telegram’s Mini Apps documentation states that Mini Apps allow JavaScript interfaces with flexible HTML/CSS UI inside Telegram. This is the route for arbitrary branded button colors and full custom layout, rather than ordinary inline keyboard markup. The official page is https://core.telegram.org/bots/webapps.

## Current conclusion

Qamify’s green buttons are most consistent with Telegram’s newer predefined button style support (`bg_success`) and Telegram Web’s client-side rendering. Ordinary inline-keyboard text does not itself specify arbitrary CSS colors. A true custom palette requires a Mini App; a bot-only implementation can reproduce the supported primary/danger/success styles if the project’s Telegram library/API payload supports the newer `style` field.

## Representative button-type evidence

A second Telegram Web inspection of the Qamify Chat showed product controls such as `Gemini AI Pro 18 Month`, `LEONARDO AI VIDEO GEN`, and `Canva Business Panel With Leonardo` as ordinary `<button>` elements. They had Telegram Web classes such as `Button ... tiny primary ...`, no `href`, and no DOM attributes exposing `callback_data`, `web_app`, or a destination URL. This is consistent with callback-style inline buttons, but the callback payload is not exposed by Telegram Web’s rendered DOM.

The same inspection found no representative Qamify Web App launch control and no `web_app` attribute in the inspected DOM. Telegram Web’s client-rendered HTML is therefore insufficient to prove the original Bot API payload type with certainty: it can show that a control is not rendered as a normal anchor and can show the client style, but it does not reveal the bot’s hidden callback data. The controls should not be classified as Web Apps based on appearance alone. A Web App would normally be represented in the Bot API update/message payload by an InlineKeyboardButton `web_app` field and would launch a Telegram-hosted HTML interface; no such launch was observed during this audit.

For Nebula Nook, the implementation now uses ordinary callback and URL inline buttons plus Telegram’s explicit `style` field (`success` for action/claim/buy/join controls and `primary` for navigation/product links). Arbitrary custom colors still require a Mini App.

## Confirmed versus inferred button types

The inspected Qamify product controls are **confirmed ordinary rendered buttons** with no `href`; their callback behavior is **inferred** from the fact that they are interactive bot controls and from the absence of an anchor destination, but their hidden `callback_data` was not available in the DOM. No inspected Qamify control was a confirmed URL button: Telegram Web did not expose an anchor/href for the product controls examined. No Web App control was confirmed either. Therefore, the audit establishes the client-side style and strongly supports callback-style product controls, while explicitly leaving URL/Web App classification unconfirmed for Qamify’s private bot payload without Bot API message JSON or an observed launch event.
