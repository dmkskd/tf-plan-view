# `tfview` CLI

`tfview` is a standalone Rust binary that includes the HTML, CSS, and JavaScript required to render Terraform plans. It can run `terraform plan` itself, read an existing JSON plan, or add a model-generated review before rendering. The resulting HTML report contains the plan and the rendering code in one file.

## Build and run

The built binary does not require Node.js, npm, Rust, or Cargo at runtime. Terraform must be installed and on `PATH` only when `tfview` generates a plan; opening an existing JSON plan does not require Terraform.

Building the binary from a checkout requires Node.js and npm for the embedded web page, Rust and Cargo for the CLI, and `just` for the commands below:

```sh
npm ci
just cli-build
cli/target/release/tfview --help
```

`just cli-build` builds `dist/index.html` and embeds it in the release binary at `cli/target/release/tfview`. The CLI must be rebuilt after a frontend change to include the new bundle. `just cli-install` installs the binary in Cargo's bin directory (normally `~/.cargo/bin`) for use on the shell `PATH`. The examples below assume that `tfview` is on `PATH`; otherwise, `cli/target/release/tfview` can be used.

## Commands

### Generate a plan

Run the command from a Terraform working directory that has been initialized with `terraform init`:

```sh
tfview plan
tfview plan --offline --output report.html --no-open
tfview plan -- -var-file=prod.tfvars
tfview plan --destroy
```

`plan` runs `terraform plan -lock=false` with a binary plan in a temporary directory, converts that plan with `terraform show -json`, and removes the binary plan after conversion. It does not apply changes. Arguments after `--` are passed to `terraform plan`; `-out` and `-lock` cannot be overridden. Terraform's normal plan behavior still applies, including provider or data source calls where applicable. `--offline` adds `-refresh=false`, which skips refreshing managed resource state but is not a general network isolation mode. `--destroy` requests a destroy plan preview.

### Open existing plan JSON

Produce JSON with Terraform, then give it to `open` as a file or through standard input:

```sh
terraform plan -out=plan.out
terraform show -json plan.out > plan.json
tfview open plan.json
terraform show -json plan.out | tfview open -
```

With piped input, the file argument may be omitted. A JSON plan can also be piped directly to `tfview` without a subcommand. `open` checks that the input is valid JSON and embeds it in the report; use output from `terraform show -json` for the expected diagram data. It does not call Terraform or an LLM.

### Review a plan with a model

`explain` takes an existing JSON plan or, when no file is supplied, generates a temporary plan using the same process as `plan`. A model is required. Specify it with `--model` or `TFVIEW_MODEL`; identify the provider with `--provider` or a recognized prefix such as `ollama::`.

```sh
tfview explain plan.json --model ollama::my-model
tfview explain plan.json --provider openai --model my-model --output review.html
tfview explain plan.json --model ollama::my-model --json-out enriched-plan.json --no-open
tfview explain plan.json --model ollama::my-model --json > enriched-plan.json
tfview explain --model ollama::my-model --offline -- -var-file=prod.tfvars
```

The default review covers changed resources (`--scope changes`) at standard depth (`--depth standard`). Changes exclude resources whose only actions are `no-op` or `read`. `--scope full` instead takes resources from the plan's `planned_values`, including child modules. `--depth expert` uses a more detailed review prompt. The model returns a summary, risk level, blast radius, warnings, and optional notes keyed by resource address. These results appear in the terminal summary and under `annotations.llm_review` in the enriched plan, together with provider, model, scope, depth, duration, and any token counts returned by the provider. Model output is an assessment, not a validation of the Terraform plan.

The CLI sends the selected resources' addresses, types, actions or planned values, and relevant before and after values to the model. It replaces fields identified by Terraform's sensitivity masks and common credential-like attribute names before sending them. Other plan content, including names, identifiers, configuration values, or sensitive data that those checks do not recognize, may still be sent. A remote provider's data handling requirements should be checked before running `explain`. Ollama normally uses a local endpoint; `--endpoint` can change where a request goes.

To limit request size, the CLI selects at most 150 resources, prioritizing replacements and deletions for change reviews and core infrastructure for full reviews. It further reduces the selection when the serialized payload exceeds 250,000 bytes and more than ten resources remain. The CLI reports when it has truncated the selection. With no selected resources, it produces a review stating that there were no resources to analyze and makes no model call.

## Output and file handling

By default, each command opens the report in the default browser. Without `--output`, the HTML lives in a temporary directory while `tfview` remains active. Press Enter or Ctrl+C to end the preview; the temporary directory is removed on normal exit. When standard input is piped, the CLI tries to read the dismissal from the controlling terminal. If none is available, it keeps the report for 15 seconds before exiting. `--no-open` prevents browser launch, but a temporary report still has this lifetime.

Use `--output report.html` (or `-o`) to save the HTML for later use. The command then exits after writing it; add `--no-open` if the browser should stay closed. The saved HTML contains the embedded plan. Treat it as sensitive if the plan contains sensitive values.

For `explain`, `--json-out PATH` saves the enriched plan JSON and can be combined with HTML output. `--json` writes only enriched JSON to standard output and suppresses the browser and HTML report; progress and diagnostics go to standard error. The enriched JSON retains the original plan data alongside `annotations.llm_review`. Redaction applies to the model request, not to saved HTML or enriched JSON.

## Option reference

| Option | Commands | Effect |
| --- | --- | --- |
| `-o`, `--output PATH` | all | Save a standalone HTML report. |
| `--no-open` | all | Do not launch the browser. |
| `--offline` | `plan`, `explain` without a file | Add `-refresh=false` to `terraform plan`. |
| `--destroy` | `plan`, `explain` without a file | Add `-destroy` to `terraform plan`. |
| `-- TERRAFORM_ARGS...` | `plan`, `explain` without a file | Pass additional arguments to `terraform plan`, except `-out` and `-lock`. |
| `--provider NAME` | `explain` | Select `openai`, `anthropic`, `gemini`, `ollama`, `groq`, `deepseek`, `cohere`, or `xai`. |
| `-m`, `--model NAME` | `explain` | Select the model; required unless `TFVIEW_MODEL` is set. |
| `--scope changes\|full` | `explain` | Select changed resources (default) or the full planned architecture. |
| `--depth standard\|expert` | `explain` | Select the standard (default) or expert review prompt. |
| `--endpoint URL` | `explain` | Override the model service endpoint; `--url` is an alias. |
| `--api-key KEY` | `explain` | Supply a key for the selected model provider. |
| `--json-out PATH` | `explain` | Save enriched plan JSON. |
| `--json` | `explain` | Write enriched plan JSON to standard output and skip HTML output. |

`TFVIEW_PROVIDER`, `TFVIEW_MODEL`, `TFVIEW_ENDPOINT`, and `TFVIEW_API_KEY` provide the corresponding `explain` options through environment variables. `OLLAMA_HOST` is used for Ollama when `--endpoint` and `TFVIEW_ENDPOINT` are absent. Provider credentials may also be resolved by the underlying `genai` client. Run `tfview <command> --help` for the current command syntax.
