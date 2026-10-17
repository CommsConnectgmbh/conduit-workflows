# Conduit Workflows

Turn real app recordings into reviewable walkthroughs and short videos on your own computer.

This first workflow combines a local video specification with a Remotion renderer. It is intended for product builders who want to turn an actual application flow into a landscape walkthrough, a separately paced portrait clip, and caption files.

Use it from a terminal, or ask your coding agent to run it through [Conduit](https://tryconduit.de). Conduit connects you to the agent on your own computer. This repository contains the video workflow; the [Conduit Bridge](https://github.com/CommsConnectgmbh/conduit-bridge) is a separate project.

## Production approach

Record the application you actually use, choose the useful source ranges, and write captions that match the visible actions. Keep private recordings and generated outputs outside the Git working tree. Review both formats before publishing.

The first pilot uses captions without narration. The video pipeline does not need a model API key. An AI agent used to prepare or run a workflow has its own account and usage requirements.

See [WORKFLOW.md](WORKFLOW.md) for a task you can give your agent and the checks that define a completed run.

## Licensing

Remotion has its own [license and eligibility rules](https://www.remotion.dev/docs/license/pricing). Its free license covers eligible individuals and organizations; company licensing can apply to other users. This repository cannot grant rights to third-party dependencies or to recordings supplied by users.

## Run locally

Install Node.js 26.11.0 (pinned in `.node-version`) and put `ffmpeg` and `ffprobe` on your PATH. From this directory:

```sh
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run test:e2e
npm run example -- --out ../conduit-video-example
```

Use a new output directory for each recording. The example records the small local pages in `examples/neutral`; the resulting video is a technical example, not footage of a product.

## Record your application

Copy [examples/record-plan.json](examples/record-plan.json) and adapt its allowed hosts, viewport, navigation steps and masks. The supplied plan visits `example.com` and uses no account. Run a probe and inspect the images in the output's `probe/` directory, then record:

```sh
npm run record -- --plan examples/record-plan.json --out ../my-recording --probe
npm run record -- --plan examples/record-plan.json --out ../my-recording
```

Plans support `goto`, `wait`, `waitFor`, `scroll`, `followLink` and `mark`. A `waitFor` or `followLink` step takes a selector or text; `scroll` takes a selector or a vertical position plus `durationMs`. Marks identify points in the recording. For an authenticated demo, `storageState` may point to an existing Playwright state file outside the repository; the recorder reads it without writing it back. Keep account-specific plans outside Git as well.

The recording output is `recording.mp4` plus a contact sheet and `guard.json` with timestamps and blocked requests. Browser requests are restricted to the configured hosts and GET/HEAD; the available actions navigate and scroll through existing content.

## Render your edits

For your own project, keep the specification and recordings in a separate private directory. Use `examples/neutral/spec.json` as the format reference:

```sh
npm run render -- --spec ../private-video/spec.json --check
npm run render -- --spec ../private-video/spec.json --out ../private-video/render
```

The source ranges in the specification are measured in seconds. `long` and `short` have separate scene lists. Source media paths are relative to the specification directory; `--media-dir` can select another media directory.

An existing browser WebM without duration metadata can be converted first with `node scripts/prepare.ts ../input.webm ../prepared.mp4`.

## Outputs and scope

Each cut produces an H.264 MP4, SRT and VTT captions, a poster, a contact sheet, scene stills and a narration text file. The JSON report records dimensions, frame count, frame rate, duration, caption boundaries and measured stage runtimes.

Recording plans, edit plans and copy are explicit inputs. The first pilot starts from prepared footage and an authored specification. Conduit supplies the remote connection to the coding agent that executes the local commands. The workflow can also be run directly.

The integration tests use real Chromium and FFmpeg to check capture geometry, opaque DOM masking, clip boundaries, caption timing and preservation of existing outputs. DOM masking covers configured elements and matching text; image pixels and canvas contents need a separate visual review.

[Deutsche Fassung](README.de.md)
