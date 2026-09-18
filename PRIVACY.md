# Glean Privacy Policy

Effective date: September 10, 2026

Glean is a browser extension for learning languages with interactive video subtitles. This policy explains what data the extension handles and when data leaves the browser.

## Data stored locally

Glean stores extension settings, the API configuration entered by the user, and cached AI word explanations in `chrome.storage.local`. This data stays in the user's Chrome profile unless the user invokes an AI feature as described below. Uninstalling the extension removes extension-local storage according to Chrome's behavior.

## AI requests

AI features are optional and disabled until the user enters an API key. When the user requests translation, word explanation, model discovery, or sentence analysis, Glean sends the relevant subtitle text, selected word, surrounding sentence, model settings, and API key directly to the AI provider or custom HTTPS endpoint selected by the user.

The selected provider processes that request under its own privacy policy. Glean does not operate an intermediary server for these requests and does not receive a copy of them.

## Video and subtitle data

Glean reads video playback state and available subtitle data on supported video sites to provide synchronized subtitles and learning controls. This information is processed in the browser. It is not sold, used for advertising, or sent to the publisher.

## Permissions

- `storage`: saves settings and AI response cache locally.
- Supported video site access: reads video and subtitle state on YouTube, Bilibili, and Quark Pan.
- Official AI provider access: sends requests only when the user enables an AI feature.
- Optional website access: requested only when the user configures a custom HTTPS AI endpoint.

## Analytics and advertising

Glean does not include advertising, analytics, tracking pixels, or telemetry. It does not sell or transfer user data for advertising, credit, or data-broker purposes.

## Retention and deletion

Local settings and cached explanations remain until the user clears extension data or uninstalls Glean. Data sent to a selected AI provider is retained according to that provider's terms and privacy policy.

## Security

Glean does not bundle API credentials. Users should only configure providers they trust and should revoke a key immediately if they believe it has been exposed.

## Changes and contact

Material changes will be published with an updated effective date. Privacy questions can be sent through the support contact and support URL displayed on Glean's Chrome Web Store listing.
