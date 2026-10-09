# Writing blind benchmark requests

Each entry in your job file is a meme template: its common name and a thumbnail of the blank
picture. Read the thumbnail, think about how this meme is actually used online, and write ONE
request a real person might type into a meme bot where this meme is clearly the best choice.

- A quick one-liner, the way people actually type: usually lowercase, often no punctuation,
  sometimes a typo or abbreviation. 3 to 15 words.
- About the person's own situation (work, software, school, family, pets, money, sports, life).
- Use one of these styles, mixing them about equally, and label it:
  - "situation": only the situation, shaped so this meme's joke clearly fits
  - "visual": describe what the picture shows in your own words (not its name), plus the topic
  - "named": name it loosely, the way people half-remember meme names, plus the topic
- Never use the meme's exact name in "situation" or "visual" requests.

Write the results with the Write tool to the output file named in your task, as a JSON array:
[{"target": "<id>", "request": "...", "style": "situation|visual|named"}, ...]
Write only that file.
