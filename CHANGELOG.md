# Changelog

All notable changes to Meme Factory. Versions follow [semantic versioning](https://semver.org).

## 0.5.0 (2026-10-08)

### A new look
- The "Highlighter" palette and a meme-caption wordmark on a chartreuse sticker, in the panel and the gallery, with an eggplant dark mode.
- The panel shows draft picks and scores in its tabs (`● Drake 9`), the Write / Judge / Render stages, and a compact strip of up to six rows in narrow windows.
- The gallery has a progress bar, PICKED and TOP SCORE stickers, a chat column, and the panel's keys.

### Posting
- A **Post to** list (favorites, your Slack channels, places Claude can reach, + Add a connector), quick picks `1` `2` `3`, and `p` to post.
- One post at a time, a confirm step when ask-before-posting is on, and clear posted and couldn't-post states with the message link.
- Destinations match whole words, so `#dev` doesn't catch `#devops`.

### Fixes
- New meme and Check again in the gallery now work. The mod tells the gallery server which events it handles.
- Reloading the gallery page keeps working.
- Truncated or empty image downloads are never drawn or uploaded.
- A judge that doesn't answer keeps the drafts. Junk scores no longer show `NaN`.
- Stored settings and history are validated. Favorites are deduplicated and capped at 20.
- The gallery server rejects malformed input, compares the token in constant time, and sends a stricter Content Security Policy.

### Also
- Demo videos built with HyperFrames (`demo/`), and an adversarial test suite.

## 0.4.0 and earlier

- Post to Slack from the panel, with the image uploaded by the mod and signed "Fresh from the Meme Factory".
- A chat box that turns plain words into remixes, picks, approvals and posts.
- The browser gallery, posting settings, and ask-before-posting.
- Real meme images in Ghostty and kitty, and a note in terminals that can't draw them.
- The first release: make, approve and post memes from Claude Code.
