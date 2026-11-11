# Red flags — rationalisations for skipping a step

Load when a thought on the left is about to justify skipping a step of `explore-idea`,
downgrading the request's class, or handing off without an explicit yes. Each row names
the rationalisation and what to do instead.

| Rationalisation | Correct response |
|---|---|
| "This is too simple to need a design." | Simple requests are where unexamined assumptions do the most damage. Size it out loud (Step 1); a spike or bounded class is the short path, not skipping the path. |
| "I know this kind of app, so it's bounded." | Familiarity with the genre is not knowledge of this owner's constraints. Classify on what the owner said, and move the class up when a question uncovers more. |
| "That answer made it smaller — downgrade to bounded." | The class moves up, never down. An answer that shrinks one part rarely removes the structural choices that made it architectural. |
| "I'll ask everything at once to save time." | A wall of questions gets partial answers and silent defaults. One question, with options and a recommendation, then wait. |
| "The owner will not follow the trade-offs; just pick." | Pick a recommendation and say why, but show the options with pros and cons in plain terms — the decision is theirs, and the log records that they made it. |
| "I'm fairly sure what the market / vendor / limit is." | Fairly sure is a guess. Draft the research prompt (Step 5) and mark the decision `open (research)`. |
| "The repo probably does not matter yet." | Read it first (Step 2). A question the repo already answers costs the owner's time and signals the context was skipped. |
| "It's all one project." | Pieces that ship or fail independently are sub-projects. Split them (Step 3) before one swallows the conversation. |
| "The log is obvious from the chat." | Chat scrolls; the log is what `specify` carries into the spec. Reprint it whenever it changes. |
| "They said 'sounds good' — that's approval." | Approval is an explicit yes to the summarised direction, not agreement with one point. Ask. |
| "I have enough to write the spec myself." | This skill writes no spec. Hand the log to the `specify` skill, which owns the spec and its annotated review. |
| "Another plugin's brainstorming skill already covers this." | It does not carry the log into the spec or stop at the annotated review; route idea work here and spec work to `specify`. |
| "Better confirm that decision again before building on it." | A decision recorded in `status/ideas.md` is settled. Build on it; reopen it only when the owner does, as a new row that supersedes the old one. |
| "The ideas are only notes — no need to write the file." | Ideas left in chat are lost at the session's end. Capture writes `status/ideas.md` with stable `I-N` ids before asking anything. |
