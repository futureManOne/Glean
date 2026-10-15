# Glean (拾句)

Open-source browser extension providing bilingual subtitles, AI in-context vocabulary parsing, single-sentence linguistic analysis, and playback synchronization across YouTube, Bilibili, Quark Pan, and HTML5 video platforms.

## Language

**Cue**:
A single timed subtitle event containing numeric start/end timestamps and text in source and target languages.
_Avoid_: Subtitle row, caption item, transcript line

**VideoPlayerAdapter**:
An adapter satisfying the unified playback seam for a host streaming video element.
_Avoid_: Player controller, player wrapper, host bridge

**SubtitleSniffer**:
A multi-layered background engine sniffing subtitles from native TextTracks, dynamic DOM captions, and intercepted network payloads.
_Avoid_: Subtitle extractor, caption watcher, DOM scraper

**MixedGloss**:
A dynamic learning mode where target language vocabulary or phrasal verbs within a sentence are selectively translated in-place.
_Avoid_: Inline subtitle, hybrid translation, mixed subtitle

**PriorityBatchQueue**:
A playback-head-aware priority queue scheduling subtitle batches closest to the current video playback time with seek preemption and forward streaming.
_Avoid_: Request queue, translation scheduler, subtitle batcher

**WordExplanation**:
A structured linguistic breakdown of an English word in sentence context, including CEFR rating, IPA, definition, and grammatical intent.
_Avoid_: Dictionary entry, word card, vocabulary lookup

**SentenceAnalysis**:
A multi-dimensional linguistic breakdown of an entire sentence covering authentic translation, nuances, grammatical syntax, idioms, and listening tips.
_Avoid_: Sentence explanation, line breakdown, speech card

**ShadowRootOverlay**:
The isolated Web Component host (`<language-reactor-overlay>`) mounting all Glean extension UI inside an encapsulated Shadow DOM.
_Avoid_: Floating UI, injection layer, iframe
