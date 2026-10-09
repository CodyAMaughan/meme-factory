# Judging a benchmark miss

Each entry is a meme request from the benchmark, the template it was written for (`target`), and
the three templates the system picked instead (`picked`), each with its card. For each entry:

1. Verdict: is the target clearly the best meme for this request, or is one of the picked
   templates as good or better? Judge only fit: does the joke's structure and what the person
   describes (or names) match the template's meaning and box roles? Ignore popularity.
   - "target": the target is clearly better; the system is wrong.
   - "picked": one of the picks fits as well or better; name it in `better`.
2. If "picked": explain in one line why the original request didn't single out its target
   (`why`), and write a new request for the target that does (`new_request`): same rules as
   before — a casual one-liner, lowercase, maybe a typo, 3 to 15 words, about a real situation,
   in the same style as the original, pointing clearly at the target's own joke and not at the
   template you named in `better`.

Write a JSON array to the output file named in your task, one object per entry, in order:
{"qid": "...", "verdict": "target|picked", "better": "<id or null>", "why": "...", "new_request": "..."}
Write only that file.
