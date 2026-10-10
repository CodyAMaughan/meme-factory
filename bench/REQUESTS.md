# Writing benchmark requests

Each entry in your chunk file is one meme template from the Meme Factory catalog (its id, name,
what kind of joke it tells, its core idea, each text box's role, other names for it, and what it
is not for). For each template, write ONE request a real person might type into a meme bot, where
this template is clearly the best meme to use out of ~1,500 common meme templates.

What a request looks like:
- A quick one-liner, the way people actually type: usually lowercase, often no punctuation,
  sometimes a typo or abbreviation ("abt", "u", "w/", "standup", "pr", "jira"). 3 to 15 words.
- About the person's own situation: work, software, school, family, pets, money, sports,
  everyday life. Vary the topics across the chunk.
- It must point at THIS template, not just any meme. Use one of these styles, mixing them about
  equally across your chunk, and label which:
  - "situation": only the situation, but shaped so this template's joke structure clearly fits
    (its shape and box roles). Example for a lopsided-trade meme: "my boss wants me to work
    saturday in exchange for a pizza"
  - "visual": describes what the picture shows, without its name, plus the topic. Example: "the
    guy sweating over two red buttons but its tabs vs spaces"
  - "named": names it loosely, the way people half-remember meme names, maybe misspelled, plus
    the topic. Example: "drake meme about meetings vs emails", "that spongbob rainbow imagination one for my side project"
- Never copy the template's exact name in "situation" or "visual" requests.
- If a template is so generic or obscure that no request could make it the clear winner over a
  more famous meme, still write your best attempt and set "weak": true.

Write your results to the output file named in your task, as a JSON array:
[{"target": "<template id>", "request": "...", "style": "situation|visual|named", "weak": false}, ...]
One entry per template, in the same order. Write only that file.
