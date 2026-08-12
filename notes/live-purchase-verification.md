# Live purchase verification — 2026-08-12

The logged-in Telegram session showed Qamify Chat group announcements such as `Qamify: User S***** just bought 1× Gemini AI Pro 18 Month!`, confirming completion notices are posted to a group rather than sent as a personal admin DM.

Nebula Nook’s compact Shop response showed `Page 1 of 2` with current product cards. The first legacy `Gemini Pro` item was unavailable because its stock is 0. The seeded testing catalog remains in stock: ChatGPT Starter Access (25), Gemini Pro Trial Link (40), Surfshark Trial Coupon (20), Canva Creator Access (15), CapCut Premium Trial (12), and Notion Plus Coupon (10).

The approved click on the stale item correctly returned `This product is currently unavailable.`. A subsequent DOM audit identified current `Buy now` controls for the in-stock seeded products, but the click did not create a new order; the latest database order remains order 60001 for product 30005, status fulfilled. Existing notification delivery records include sent group notifications and one historical failed delivery caused by malformed HTML entity parsing.

The implementation and tests for compact Shop navigation, automatic wallet-paid completion, and group-only notification routing are complete; a clean live purchase smoke test against an in-stock current product remains inconclusive and should not be claimed as verified until a new order appears in the database.
