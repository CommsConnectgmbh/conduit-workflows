# App recording to reviewable video

Use this workflow with your coding agent on the computer that holds your app and media. [Conduit](https://tryconduit.de) can provide the remote interface to that agent. The renderer also runs directly from a terminal.

## Task to give your agent

> Produce a product walkthrough from a real recording of this application. Use the local video pipeline in this repository. First inspect the available recording, application source and video specification. Confirm that each caption describes what the recording actually shows. Keep sessions, source recordings and outputs outside this repository. Render a landscape walkthrough and a separately paced portrait version, export captions, and inspect the results. Report measured durations, output paths and any remaining manual steps. Stop before publishing or sending anything.

Add the paths to your application, recording, specification and output directory. Use paths on the computer running the agent.

## What the human decides

- The question the video should answer and the audience it should help.
- Whether the recording may be shown publicly.
- The final wording, claims and call to action.
- Whether the reviewed result should be published.

## What to check before rendering

- The recording comes from the actual application.
- The account contains only approved demonstration material.
- Passwords, tokens, personal data and customer names are absent from the recording.
- Each source range contains the intended action and stays inside the media duration.
- Captions remain readable in both formats.
- The portrait version has its own sequence and pacing.

## What counts as a completed run

- Both videos exist and decode successfully.
- The exported dimensions, frame rate and durations match the specification.
- Captions and callouts have been inspected against representative rendered frames.
- The report states which work was done by an agent and which choices were made manually.
- Public repository files contain only approved generic material.

A successful render proves that the pipeline produced files. It does not establish the accuracy of product claims or the effectiveness of the marketing.
