# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. You'll get a reply within a few days, and a fix or a plan once the report is confirmed.

Include what you found, how to reproduce it, and what an attacker could do with it.

## What's in scope

- The mod's hooks (`hooks/`): how it handles model output, connector results, and the posting flow, including ask-before-posting.
- The browser gallery (`gallery/`): the local server's token and origin checks, and the page.

Bugs in Claude Code itself, in memegen.link, or in a connector belong with those projects.

## How the mod limits risk

- Everything a model writes, and every event from the gallery page, is treated as untrusted and validated before it reaches a tool call, a process, or a prompt.
- Posts go only to destinations you choose. Ask-before-posting (on by default) holds any post until you confirm it.
- The gallery server listens on `127.0.0.1` only. It requires a per-session random token, checks the `Host` and `Origin` headers, and stops with the session.
