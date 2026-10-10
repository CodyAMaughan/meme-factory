# Changelog

All notable changes to Meme Factory. Versions follow [semantic versioning](https://semver.org).

## 0.12.3 (2026-10-10)

- **The browser gallery shows your drafts again.** Since 0.11.0 it stayed on "Cooking drafts…".
  - **Why:** the state the mod sends the page carried the whole meme picker. At about 1,500 templates that's over 300 KB, past the 256 KB the gallery server accepts, so every update was refused without a word.
  - **The fix:** the picker now goes on its own, once, and again only when the catalog changes. The page fetches it when the state says it changed. The state it polls for is small again.
  - **Refusals are logged:** an update the gallery refuses now goes in the debug log (`meme_factory_debug` status), so a page stuck on its first screen says why.

## 0.12.2 (2026-10-10)

- **A clean catalog.** Every template was screened again, picture and words, for a work Slack: 92 offensive or crude ones are gone (swearing in the name or printed on the picture, bathroom and pickup-line jokes, drugs or drunkenness as the point, stereotypes, guns and gore played straight), 14 of them from the built-in list. Another 42 kept their picture and got clean names, aliases or example captions; 10 got new ids (`soup-nazi` is now `nosoup`). About 1,400 templates remain.
- **Imgflip's daily top 100 is no longer read.** It added templates nobody had looked at, filtered only by a word list. `MEME_FACTORY_IMGFLIP` is gone, and cards kept from that list by earlier versions are dropped.
- A template taken off the server leaves your catalog at the next session, including one whose card the model wrote.

## 0.12.1 (2026-10-10)

- **The chat box decides when you want new memes.** Asking for different pictures only worked if you used one of a few words ("different", "another", "switch"); anything else rewrote the captions on the same three memes. That word list is gone. The chat model now reads what you mean and chooses: the same pictures with new words, new pictures (staying away from every template already shown for that request), or new pictures except the drafts you said you like.

## 0.12.0 (2026-10-10)

- **Better at finding the right meme.** Measured on a new benchmark (bench/): about 2,400 requests, one to three per template, a 70/30 split, and a held-out set written by people who only saw the picture. On that set the right template now lands in the top three 90% of the time, up from 76%; for requests that describe only a situation ("my boss wants me to work saturday for a pizza"), 77%, up from 53%.
  - Haiku writes the card of the ideal template (HyDE) and names 15 candidates from the whole catalog, in parallel; then reranks the search's best 200, with their pictures. The writer still chooses, from the 40 that come out. Any step that fails falls back to the search.
  - Every template's card now describes its picture ("man in orange jacket holding hand up refusing"), and the search weighs it.
  - A meme asked for right as a session starts waits (up to 5 seconds) for the server's templates.
- **74 duplicate templates removed** from the server (the same picture under two names); their names live on as aliases of the copy kept.

## 0.11.0 (2026-10-09)

- **About 1,500 templates.** The Meme Factory's own server adds some 1,300 of Imgflip's most popular templates of all time to memegen.link's 210. Each was laid out by a model looking at the picture (boxes where people put the text) and given a card (what it means, each box's role, its popularity rank). Offensive, obscure and duplicate templates were left out.
- **Search for the right meme.** A quick model (Haiku) turns the request into search words, a ranking scores every card (BM25 over name, aliases, shape, idea and box roles; popularity on a log scale as a tiebreak; a mix of joke shapes), and the writer chooses from the best 40 instead of the whole catalog. memegen.link's templates got Imgflip popularity ranks too.
- **The Meme Factory server by default.** Without `MEMEGEN_URL`, pictures come from it: open to all, a "Meme Factory" watermark without a key, 60 requests a minute per address. If it's unreachable the mod falls back to memegen.link.
- Same-named templates are merged, keeping the more popular; an Imgflip copy gives way once the server's version loads.

Tested in the desktop app (2.1.293) against the server: 1,511 templates loaded; drafts drew on new templates (Surprised Pikachu, This Is Where I'd Put My Trophy, Boardroom Meeting Suggestion).

## 0.10.0 (2026-10-09)

- **More templates.** Besides the 210 built-in ones:
  - **Imgflip's popular list**, checked once a day: top-and-bottom memes memegen doesn't have, such as Bernie "once again asking", Monkey Puppet and Absolute Cinema, rendered over Imgflip's picture. Set `MEME_FACTORY_IMGFLIP=0` to leave them out.
  - **Your own memegen server's** (`MEMEGEN_URL`): any template it has that memegen.link doesn't, with its own text boxes.
  - A model writes each new template's card once, 15 at a time, and the card is kept. It's told not to repeat words already printed on the picture ("i receive:"). A meme it doesn't know is skipped and asked about again after a month.
  - Names that only differ in wording count as the same meme ("Roll Safe Think About It" is Roll Safe), so Imgflip doesn't add duplicates.
  - The gallery's picker searches them too, and `meme_factory_debug` shows the count (`refresh` checks again).

Tested in the desktop app (2.1.293): 28 new templates loaded from Imgflip and the self-hosted server; a Trade Offer meme (a template added to the server) drafted and rendered there.

## 0.9.1 (2026-10-09)

- **Keys work after you've typed in the chat box.** After a message you sent, the next key typed into **Say** again, or went to Claude's prompt when the panel changed. A click on the panel didn't help either: in the terminal a click presses a button but leaves the keyboard in the box. Now a sent message hands the keys back to the panel, and so does a click on any of its buttons or on the header.
- **The same keys on every screen.** Each screen shows its own actions first (Approve, Remix and More like this; Post and Back; Open, Save and Post elsewhere; Retry), then `c` Copy, `n` New, `v` Browser and `t` Talk, always in that place and order. **New** used to appear on only two screens, and **Talk** and **Browser** came and went. While the panel asks "Post to …?", `n` stays No, so **New** steps out for that one question.
- **A new meme starts a new chat.** New, a meme Claude asks for, `/meme` and the gallery all start with an empty chat; one you ask for in the chat box keeps the line that asked for it.
- **Slack in the desktop app's auto mode again.** Its Claude Code (2.1.293) puts the mod's direct Slack calls to auto mode's check after all, so channels didn't load and uploads were refused. When that happens the mod now goes through Slack's tools, approving its own channel list and upload (the share only while a post you confirmed is running), and if that's refused too, the panel names the permission rule to add.

Tested in the terminal (Claude Code 2.1.296, docked and narrow): typing in Say then clicking the header or a button, sending a message (with and without the screen changing), then using hotkeys; New from every screen; the old chat staying gone. In the desktop app (2.1.293, auto mode, no permission rules): channels and the upload check. Auto mode refused the direct calls in one session and allowed them in the next, so the fallback is covered by tests rather than seen live.

## 0.9.0 (2026-10-09)

- **Post from the panel, to anywhere.** Places the mod can't upload to itself (Gmail, LinkedIn, a Slack connection without upload tools) used to be handed to Claude as a message in your conversation, which waited until Claude was free and then asked **Post it?** in the chat. Now you confirm in the panel, and the mod's own posting helper, a background agent, posts there with your connectors. Its answer and the message link come back to the panel; your conversation with Claude never sees it.
  - The helper's own hooks hold it to the job: connectors only, and one post, carrying the meme you approved. A mod's hooks never see a subagent's calls, so the rules live in the helper's agent definition, like the picture check's.
  - The panel trusts the post the helper's hooks recorded, not the helper's word: a post it claims but never made shows as not posted.
- **Slack's own plugin is detected.** A Slack connection with no channel list or upload tools (Slack's Claude Code plugin, and the claude.ai connector in some workspaces) shows as **Slack (through Claude)**. It used to be missed, and listed as "Email" because its user search mentions email. These connections post the meme's link: Slack shows the picture only where the mod can upload it.
- **No permission allowlist.** The mod's own Slack calls go straight to the server (`$.mcp.call`), confirmed in the panel, so auto mode has nothing to refuse and the `tool.check` allowlist is gone.
- **Claude's memes show up in narrow windows.** Below 144 columns, Claude Code won't open a panel the mod opens on its own, and all you got was a toast. The strip now shows above the prompt, with **Open the panel** (`e`) to dock it; once you've opened it, Claude's memes open it from 110 columns.
- **The chat box clears when you send.** Claude Code empties the field only once the send returns, and it waited for the whole chat (and any remix it started).
- **`t` works after approving.** The post view had no Talk key, so `t` typed into Claude's prompt instead.
- **Helpers stay out of your conversation.** The picture check's report reached the conversation as a message Claude then answered. Reports from the mod's own helpers are dropped now.
- The chat box no longer says Slack isn't connected when only the channel list is missing.
- `meme_factory_debug` also reports where the panel is (placed, or waiting) and the posting helper.

Tested in the terminal (Claude Code 2.1.296, auto and manual modes): real posts to a Slack channel and a DM through the posting helper, checked in Slack, with no permission prompt and nothing in the conversation. Not tested: the upload path against a Slack connection with upload tools, the desktop app, Windows.

## 0.8.2 (2026-10-09)

- **Slack works in the desktop app, for real this time.** Two causes, both found by testing inside the desktop app:
  - In auto mode, the mod's own Slack calls (the channel list and the upload steps) were refused, because auto mode's classifier had no request of yours to judge them against. The mod now approves exactly those calls of its own; the final share only after you press **Post it**.
  - The desktop app wraps a connector's reply text as a JSON string, so the channel list parsed as empty. Replies are unwrapped now, and each channel is listed once.
- When Slack's channels can't load, the panel says why, with **Try again** and **Ask Claude to post it**, instead of showing no Slack.
- "Teams" no longer appears from the desktop app's own tools mentioning "agent teams".
- **Troubleshooting:** a `meme_factory_debug` tool reports connectors, channels, the last problem and a short log, can re-check them, and can test Slack's upload steps without sharing anything. `MEME_FACTORY_DEBUG=1` also writes each step to the transcript.

Tested in the Claude desktop app (auto mode), in Ghostty (auto mode) and in a default-mode terminal session.

## 0.8.1 (2026-10-09)

- **Slack shows up in the desktop app.** The desktop app can leave on-demand connector tools out of the tool list a mod sees, so the panel offered no Slack channels. The mod now asks the Slack connector for your channels by name when it isn't listed. You may get a one-time permission prompt for Slack.
- **Parallel captions.** On memes that compare or stack things (Drake, before/after, Galaxy Brain, dilemmas), the writer prefers boxes that echo each other, ideally one word swapped: "Software Factory" / "Meme Factory". The judge rewards it. It's a preference, not a rule.

## 0.8.0 (2026-10-09)

- **Your own memegen server, no watermark.** Three optional settings: `MEMEGEN_URL` renders memes on another memegen server (such as one you host), `MEMEGEN_API_KEY` removes the watermark (or `MEMEGEN_WATERMARK` sets your own), and the browser gallery loads pictures from that server. The key is sent only when the mod downloads a picture, as a header curl reads from stdin, so it never appears in a URL, a posted link, or the process list. Without these settings nothing changes.

## 0.7.1 (2026-10-09)

- Ask-before-posting recognizes your memes on any memegen server, by their image path, so a self-hosted server is covered too. Tested: posts Claude makes directly, and through a subagent, both wait for your OK.
- The picture check needs no setup and is on by default. Its helper approves its own reads of the mod's pictures in `~/.cache/meme-factory`, and nothing else, so there's no permission rule to add. Turn it off in **Settings → Drafting**.
- Demo videos re-rendered: a new "Choose the meme" clip, the `m` key, and the panel wordmark in its brand colors.

## 0.7.0 (2026-10-09)

### Pictures that read
- Narrow label boxes (Distracted Boyfriend, Left Exit, Two Buttons and 25 more, measured from memegen's template config) hold at most four words, so text never shrinks to a speck.
- A meme you name is never dropped by the one-liner filter: its shortest draft stays.
- **The picture check** (optional, Settings → Drafting): a helper agent looks at each rendered meme and fixes text that covers a face or can't be read, by shortening that box or moving the text above the picture. It runs behind the drafts.

### Choosing the meme
- **Choose the meme** in the gallery: search all 210 templates and draft three takes on the one you click, or pick it before your next meme.

### Also
- `MEME_FACTORY_DEBUG=1` logs the drafting pipeline to `~/.cache/meme-factory/debug.json`.

## 0.6.0 (2026-10-09)

### Funnier, and the right meme for the joke
- Every template has a card: the kind of joke it tells, what each box is for, and what it's not for. The writer works out the joke's shape first and picks memes that fit it.
- One-liners: at most six words a box and twelve a meme; longer drafts are dropped, and boxes that sit over a face stay short.
- A tougher judge: fit first, then surprise, specificity and brevity, with the shorter caption winning ties. Candidates are shown in a shuffled order.
- Opus writes and Sonnet judges by default; **Settings → Drafting** has a faster Sonnet-only option, and environment variables pick models per job.

### Steering
- Name a meme ("side eye", "use Drake") and it's always drafted.
- **More like this** (`m`) drafts three takes on the meme you're looking at.
- Words in quotes are used exactly as written, and the chat box can set a caption outright.
- New template: Side-Eyeing Chloe.

### Also
- The panel, the gallery and the repo share one wordmark: the sticker on Desktop and in the gallery, its colors in the terminal.
- README: models and your plan, and an optional Jev section.

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
