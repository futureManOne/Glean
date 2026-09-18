# Glean Chrome Web Store Listing

## Single purpose

Glean helps users learn languages while watching supported web videos by displaying synchronized interactive bilingual subtitles, vocabulary explanations, and playback study controls.

## Short description

Learn from YouTube, Bilibili, and Quark videos with interactive bilingual subtitles, vocabulary lookup, and sentence replay.

## Detailed description

Glean turns supported web videos into a focused language-learning workspace.

- Follow synchronized bilingual subtitles beside the video.
- Click words for fast local definitions and optional AI explanations.
- Replay a sentence, mask a subtitle line, or jump through the transcript.
- Import local SRT, VTT, ASS, or text subtitle files.
- Save vocabulary and export it for Anki.
- Use the offline dictionary without creating an account or entering an API key.
- Connect an optional AI provider with your own API key for translation and sentence analysis.

Supported sites: YouTube, Bilibili, and Quark Pan.

Glean is an independent product and is not affiliated with YouTube, Google, Bilibili, Quark, or other language-learning extensions.

## Permission justifications

- `storage`: stores user settings and cached word explanations locally.
- YouTube, Bilibili, and Quark host access: detects video elements and reads subtitle sources to provide synchronized learning tools.
- OpenAI, DeepSeek, and Google AI host access: sends optional AI requests initiated or enabled by the user.
- Optional HTTPS host access: lets a user explicitly authorize their own custom AI endpoint. No arbitrary host is accessed before the browser permission prompt is accepted.

## Data disclosure answers

- Personally identifiable information: not collected by the publisher.
- Authentication information: an API key entered by the user is stored locally and sent only to the selected provider.
- Website content: subtitle text and selected words are read to deliver the extension's single purpose; relevant text is sent to an AI provider only when optional AI features are used.
- Analytics and ads: none.
- Data sale: none.

## Assets checklist

- Extension icons: `public/icon/16.png`, `32.png`, `48.png`, `96.png`, `128.png`.
- Screenshots: prepare 1280x800 or 640x400 captures showing the transcript, word popup, subtitle controls, and settings.
- Store icon: use `public/icon/128.png`.
- Privacy policy: publish `PRIVACY.md` at a stable public HTTPS URL before submission.
- Support contact: add a monitored email address and support URL in the Developer Dashboard.
