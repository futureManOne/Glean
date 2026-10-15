# 0001 Deep Modules and Seam Discipline

Player adapters and subtitle engines must be deep modules: hiding standard HTML5 video lifecycle operations and sniffer hooks behind small interfaces at clean seams.

Platform-specific adapters (`YouTubeAdapter`, `BilibiliAdapter`, `QuarkAdapter`, `UniversalAdapter`) must specialize only host DOM resolution (video element selection, container detection) and inherit common playback controls from `BaseVideoPlayerAdapter` rather than duplicating standard video control routines.
