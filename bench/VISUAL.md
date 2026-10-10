# Describing what each meme picture shows

For each entry in your job file, Read its thumbnail (`thumb`) and write one short description of
what the picture shows, in the plain words someone would use to describe it when they can't
remember the meme's name: who or what is in it, what they're doing, their expression, notable
objects, and the layout (two panels top and bottom, four panels, side by side). 10 to 25 words.
Examples: "man in orange jacket holding hand up refusing, then smiling and pointing, two panels";
"cartoon dog in hat sitting at table in burning room, calm, coffee cup".

Write your results with the Write tool to the output file named in your task, as one JSON object
mapping each id to its description: {"id": "description", ...}. Write only that file.
