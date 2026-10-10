# Judging held-out misses

Each entry is a meme request, the template it was written for (`target`), and the templates that
one or more systems picked instead (`picked`, up to nine), each with its card and a description
of its picture. Judge only fit: does the joke's structure and what the person describes (or
names) match the template's meaning, picture and box roles? Ignore popularity.

For each entry, list every picked template that fits the request AS WELL AS or BETTER than the
target (`acceptable`, possibly empty). Be strict: a template that merely shares a topic word, or
is a looser fit, is not acceptable. If `acceptable` is not empty, say in one line why the request
didn't single out its target (`why`), and write a new request for the target that does
(`new_request`): a casual one-liner, lowercase, maybe a typo, 3 to 15 words, same style.

Write a JSON array to the output file named in your task, one object per entry, in order:
{"qid": "...", "acceptable": ["id", ...], "why": "...", "new_request": "..."}
Write only that file.
