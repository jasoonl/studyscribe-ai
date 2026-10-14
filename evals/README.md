# AI quality evals

Checks that notes, flashcards, quizzes and Ask answers stay good when a prompt or model changes.

1. Run the app against a **local** database seeded with `scripts/demo-video/v2/seed-library.mjs`, with a real `OPENAI_API_KEY` (and the `OPENAI_MODEL` you want to test).
2. `npm run evals` generates notes, flashcards and a 10-question quiz for the recordings in `cases.json`, asks the questions there, and scores every result against its transcript. It makes about 20 AI calls.
3. It exits with an error when a check fails (wrong number of quiz questions, an answer key that isn't one of the options, duplicate cards, notes without headings, an answer that cites the wrong recording, an invented answer to a question the library can't answer) or when a score falls more than 0.1 below `baseline.json`.

Scores (0 to 1, higher is better):

- **grounding**: share of the output's words that also appear in the transcript. Low means it talks about things the lecture never said.
- **coverage**: share of the transcript's most repeated words that the output mentions. Low means it missed what the lecture was about.
- **recall** (Ask): share of the expected words the answer contains.

After a change you are happy with, run `npm run evals -- --update-baseline` and commit `baseline.json` with it. `npm run evals -- --stored` scores whatever is already stored without making AI calls. The scorers are in `server/evals/scorers.ts` and have their own unit tests.
