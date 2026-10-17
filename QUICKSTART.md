# Your first walkthrough

Start with the included recording. You do not need a Conduit connection, an app account or an AI API key for this run.

## 1. Get the project

Install [Node.js 26.11.0](https://nodejs.org/download/release/v26.11.0/) and FFmpeg, including `ffprobe`, using your operating system's package manager. Both commands must be on your PATH. Remotion has its own [license conditions](https://www.remotion.dev/docs/license/pricing).

```sh
git clone https://github.com/CommsConnectgmbh/conduit-workflows.git
cd conduit-workflows
npm ci
npx playwright install chromium
npm run doctor
```

The diagnostic reports missing tools and exits unsuccessfully if a prerequisite is missing. It does not install anything.

Keep network access available during setup and the first render: on a fresh installation, Remotion also downloads its own rendering browser.

## 2. Render the included recording

This is the same first run shown in the README and demo page. If you already ran it there, continue with step 3 or choose fresh input and output directory names.

```sh
mkdir ../my-first-conduit-input && cp docs/demo/neutral-source.mp4 ../my-first-conduit-input/
npm run render -- --spec docs/demo/spec.json --media-dir ../my-first-conduit-input --out ../my-first-conduit-video
```

The first command copies the public source recording into a separate input directory, as required by the renderer. Both input and output directories must be outside this repository. Use a fresh directory for each run; the pipeline preserves existing outputs.

Open these files:

| File in `../my-first-conduit-video/` | What to check |
| --- | --- |
| `neutral-example-long.mp4` | Landscape walkthrough, 1920 × 1080 |
| `neutral-example-short.mp4` | Independently paced portrait cut, 1080 × 1920 |
| `neutral-example-long-contact.png` | Scene overview for the landscape cut |
| `neutral-example-short-contact.png` | Scene overview for the portrait cut |
| `neutral-example-report.json` | `ok: true` and every cut check passing |
| `*.srt`, `*.vtt` | Separate captions for each cut |

The included pages and recording are explicitly a technical example. [See the original recording and published outputs](docs/demo/README.md).

## 3. Try the full recording workflow

```sh
npm run example -- --out ../my-recorded-conduit-example
```

This opens the local example pages in Chromium, records their navigation, and renders both cuts. It requires no sign-in. The new recording is in `../my-recorded-conduit-example/recording/`; the videos and report are in its `render/` directory.

## 4. Use your own app

Create a private sibling directory, such as `../my-app-video/`. Copy `examples/record-plan.json` there as `plan.json` and adapt its allowed hosts, steps and masks to an app you may record. Keep plans with account information and existing Playwright session files outside Git.

```sh
npm run record -- --plan ../my-app-video/plan.json --out ../my-app-video/capture --probe
```

Inspect the probe images. Then record into the same capture directory:

```sh
npm run record -- --plan ../my-app-video/plan.json --out ../my-app-video/capture
```

Copy `examples/neutral/spec.json` to `../my-app-video/spec.json`. Set `media.walk.path` to `capture/recording.mp4`. Watch your recording, then replace the sample source ranges and captions in **both** scene lists. `start` and `end` are seconds in the source recording. Each caption must describe a visible action. Set the title and final card to your own product.

```sh
npm run render -- --spec ../my-app-video/spec.json --check
npm run render -- --spec ../my-app-video/spec.json --out ../my-app-video/final
```

Review the finished videos before sharing. DOM masks cannot detect sensitive information inside photos or canvas. The recorder supports read-only navigation and scrolling, rather than form submissions or uploading new app data.

## Run it through Conduit

Pair [Conduit](https://tryconduit.de) with the computer that holds this repository and your media. Give its coding agent the [workflow task](WORKFLOW.md), plus the absolute paths to your specification and a fresh output directory. Recording plans, captions and source ranges still need to be prepared and checked.

## Tell us where you got stuck

[Open a first-run feedback issue](https://github.com/CommsConnectgmbh/conduit-workflows/issues/new?template=first-run.md). Tell us which step you reached, whether the outputs were useful, and what needed manual help. Share only a sanitized error excerpt; never include session files, tokens, private recordings or customer data. External-user validation is still pending.
