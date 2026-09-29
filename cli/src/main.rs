use anyhow::{bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use genai::adapter::AdapterKind;
use std::env;
use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::Builder;

mod llm;
use llm::*;

// Embed the single self-contained HTML copied into OUT_DIR by build.rs
const HTML_TEMPLATE: &str = include_str!(concat!(env!("OUT_DIR"), "/index.html"));

#[derive(Parser, Debug)]
#[command(
    name = "tfview",
    version,
    about = "Render a Terraform plan as an AWS architecture diagram",
    arg_required_else_help = true,
    after_help = "EXAMPLES:\n  \
      tfview plan                          # Generate safe ephemeral plan & view in browser\n  \
      tfview plan --offline                # Plan without remote cloud API calls (-refresh=false)\n  \
      tfview plan -- -var-file=prod.tfvars # Pass extra flags to 'terraform plan' after '--'\n  \
      tfview open plan.json                # View an existing JSON plan file\n  \
      terraform show -json | tfview open   # Stream plan JSON from piped stdin\n  \
      terraform show -json | tfview        # Piping directly also works!\n  \
      tfview explain plan.json --model ollama::glm-4.7-flash:latest # Analyze with local Ollama\n  \
      tfview explain --model gpt-4o-mini                            # Ephemeral plan & analyze with OpenAI\n  \
      tfview explain plan.json --model gpt-4o-mini --json           # Output clean enriched JSON to stdout"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Generate a safe ephemeral plan (-lock=false) and view it in your browser
    Plan(PlanArgs),

    /// Open an existing Terraform plan JSON file or piped stdin
    #[command(alias = "show")]
    Open(OpenArgs),

    /// Analyze planned changes and generate architectural annotations with an LLM (via genai)
    Explain(ExplainArgs),
}

#[derive(Args, Debug)]
struct PlanArgs {
    /// Save the self-contained HTML report to a file instead of a temporary browser preview
    #[arg(short, long, value_name = "OUTPUT_HTML")]
    output: Option<PathBuf>,

    /// Run plan in fast offline mode (-refresh=false), skipping remote cloud API calls
    #[arg(long)]
    offline: bool,

    /// Generate a destroy plan preview (-destroy)
    #[arg(long)]
    destroy: bool,

    /// Do not automatically launch the web browser
    #[arg(long)]
    no_open: bool,

    /// Pass extra arguments to 'terraform plan' after '--' (e.g. tfview plan -- -var-file=prod.tfvars)
    #[arg(last = true)]
    terraform_args: Vec<String>,
}

#[derive(Args, Debug)]
struct OpenArgs {
    /// Path to a Terraform JSON plan file (use '-' for stdin). If omitted with piped input, reads stdin.
    #[arg(value_name = "PLAN_JSON")]
    file: Option<PathBuf>,

    /// Save the self-contained HTML report to a file instead of a temporary browser preview
    #[arg(short, long, value_name = "OUTPUT_HTML")]
    output: Option<PathBuf>,

    /// Do not automatically launch the web browser
    #[arg(long)]
    no_open: bool,
}

#[derive(Args, Debug)]
struct ExplainArgs {
    /// Path to a Terraform JSON plan file (use '-' for stdin). If omitted, generates an ephemeral plan.
    #[arg(value_name = "PLAN_JSON")]
    file: Option<PathBuf>,

    /// LLM provider (e.g. ollama, openai, anthropic, gemini, groq, deepseek, cohere, xai)
    #[arg(long, env = "TFVIEW_PROVIDER")]
    provider: Option<String>,

    /// LLM model to invoke (e.g. glm-4.7-flash:latest, gpt-4o-mini, ollama::glm-4.7-flash:latest).
    /// Can also be set via the TFVIEW_MODEL environment variable.
    #[arg(short, long, env = "TFVIEW_MODEL")]
    model: Option<String>,

    /// Review scope: 'changes' (only diffed resources) or 'full' (entire architecture)
    #[arg(long, value_enum, default_value = "changes")]
    scope: ReviewScope,

    /// Review depth: 'standard' (operational risk triage) or 'expert' (Well-Architected audit)
    #[arg(long, value_enum, default_value = "standard")]
    depth: ReviewDepth,

    /// Optional custom LLM endpoint URL (e.g. http://localhost:11434).
    /// Can also be set via TFVIEW_ENDPOINT or OLLAMA_HOST.
    #[arg(long, alias = "url", env = "TFVIEW_ENDPOINT")]
    endpoint: Option<String>,

    /// Optional API key for cloud providers.
    /// Can also be set via the TFVIEW_API_KEY environment variable.
    #[arg(long, env = "TFVIEW_API_KEY")]
    api_key: Option<String>,

    /// Save the enriched Terraform plan JSON (with LLM annotations & metrics) to a file
    #[arg(long = "json-out", value_name = "ENRICHED_PLAN_JSON")]
    json_out: Option<PathBuf>,

    /// Print enriched Terraform plan JSON directly to stdout (suppresses browser launch)
    #[arg(long = "json")]
    json_stdout: bool,

    /// Save the self-contained HTML report with LLM annotations to a file
    #[arg(short, long, value_name = "OUTPUT_HTML")]
    output: Option<PathBuf>,

    /// Do not automatically launch the web browser
    #[arg(long)]
    no_open: bool,

    /// Run plan in fast offline mode (-refresh=false) if generating an ephemeral plan
    #[arg(long)]
    offline: bool,

    /// Generate a destroy plan preview (-destroy) if generating an ephemeral plan
    #[arg(long)]
    destroy: bool,

    /// Pass extra arguments to 'terraform plan' after '--' if generating an ephemeral plan
    #[arg(last = true)]
    terraform_args: Vec<String>,
}

/// Validate that user-supplied extra arguments to 'terraform plan' do not attempt
/// to override tfview's non-locking guarantee or redirect plan output to disk.
pub fn validate_ephemeral_plan_args(extra_args: &[String]) -> Result<()> {
    for arg in extra_args {
        let clean = arg.trim_start_matches('-');
        if clean == "out" || clean.starts_with("out=") || clean == "lock" || clean.starts_with("lock=") {
            bail!(
                "Argument '{}' is not permitted in ephemeral plan mode: tfview enforces safe, non-locking execution without leaving persistent plan files on disk.",
                arg
            );
        }
    }
    Ok(())
}

/// Run 'terraform plan' safely in non-locking mode and convert to JSON in-memory.
/// Captures child stdout so human-readable plan text never leaks to stdout.
fn generate_ephemeral_plan(offline: bool, destroy: bool, extra_args: &[String], temp_dir: &Path) -> Result<String> {
    validate_ephemeral_plan_args(extra_args)?;

    let bin_plan = temp_dir.join("ephemeral.tfplan");
    let bin_plan_str = bin_plan.to_str().context("Invalid temp file path")?;

    let mut plan_cmd = Command::new("terraform");
    plan_cmd.arg("plan");

    if offline {
        plan_cmd.arg("-refresh=false");
    }
    if destroy {
        plan_cmd.arg("-destroy");
    }
    for arg in extra_args {
        plan_cmd.arg(arg);
    }

    // Enforce non-locking mode and ephemeral temp path after user args
    plan_cmd.arg("-lock=false");
    plan_cmd.arg(format!("-out={}", bin_plan_str));

    eprintln!("==> [tfview] Running safe ephemeral plan (-lock=false)...");
    let plan_output = plan_cmd
        .output()
        .context("Failed to run 'terraform plan'. Is terraform installed and in your PATH?")?;

    if !plan_output.status.success() {
        let err = String::from_utf8_lossy(&plan_output.stderr);
        let out = String::from_utf8_lossy(&plan_output.stdout);
        bail!(
            "'terraform plan' failed with status: {}.\nStderr: {}\nStdout: {}",
            plan_output.status,
            err.trim(),
            out.trim()
        );
    }

    eprintln!("==> [tfview] Converting plan to in-memory JSON...");
    let show_output = Command::new("terraform")
        .args(["show", "-json", bin_plan_str])
        .output()
        .context("Failed to run 'terraform show -json'")?;

    // Shred the binary plan immediately to guarantee it can never be applied
    let _ = fs::remove_file(&bin_plan);

    if !show_output.status.success() {
        let err = String::from_utf8_lossy(&show_output.stderr);
        bail!("'terraform show -json' failed: {}", err);
    }

    String::from_utf8(show_output.stdout).context("Plan output is not valid UTF-8")
}

/// Inject the JSON plan into the self-contained HTML template.
/// Replaces `<` with `\u003c` in JSON strings to prevent `<script>` breakout XSS.
pub fn inject_plan(html_template: &str, plan_json: &str, label: &str) -> Result<String> {
    let _: serde_json::Value = serde_json::from_str(plan_json)
        .context("Input is not valid JSON. Ensure input is generated via 'terraform show -json'.")?;

    let primary_tag = "<script type=\"application/json\" id=\"injected-plan\">";
    let fallback_tag = "<script type=\"application/json\" id=\"embedded-plan\">";
    let end_tag = "</script>";

    let (_start_pos, content_start) = if let Some(pos) = html_template.find(primary_tag) {
        (pos, pos + primary_tag.len())
    } else if let Some(pos) = html_template.find(fallback_tag) {
        (pos, pos + fallback_tag.len())
    } else {
        anyhow::bail!("Template does not contain id=\"injected-plan\" or id=\"embedded-plan\" script tag");
    };

    let rest = &html_template[content_start..];
    let end_pos = rest
        .find(end_tag)
        .context("Template closing </script> tag not found")? + content_start;

    // Secure JSON against HTML </script> breakout:
    // In valid JSON, '<' only appears in string literals. Replacing '<' with '\u003c'
    // is 100% valid JSON and parses identically in JavaScript, while ensuring the HTML
    // parser never terminates the <script> element prematurely.
    let safe_plan_json = plan_json.replace('<', "\\u003c");

    let safe_label_json = serde_json::to_string(label)
        .unwrap_or_else(|_| "\"terraform plan\"".to_string())
        .replace('<', "\\u003c");

    let mut modified = String::with_capacity(html_template.len() + safe_plan_json.len() + 4096);
    modified.push_str(&html_template[..content_start]);
    modified.push_str(safe_plan_json.trim());
    modified.push_str(&html_template[end_pos..]);

    // Explicit auto-boot hook checked cleanly by app boot()
    let auto_boot_snippet = format!(
        "\n<script>\n  window.__TFVIEW_AUTOLOAD = true;\n  window.__TFVIEW_PLAN_LABEL = {};\n</script>\n",
        safe_label_json
    );

    if let Some(body_pos) = modified.rfind("</body>") {
        modified.insert_str(body_pos, &auto_boot_snippet);
    }

    Ok(modified)
}

/// Render and display (or save) the final self-contained HTML report.
/// If stdin was piped, connects to /dev/tty or uses a grace period so the browser can read the file.
fn present_report(html_content: String, output: Option<PathBuf>, no_open: bool) -> Result<()> {
    if let Some(out_path) = output {
        fs::write(&out_path, &html_content)
            .with_context(|| format!("Failed to write HTML report to '{}'", out_path.display()))?;
        eprintln!("==> [tfview] Saved self-contained report to: {}", out_path.display());
        if !no_open {
            let _ = opener::open(&out_path);
        }
        return Ok(());
    }

    let tmp_dir = Builder::new()
        .prefix("tfview-")
        .tempdir()
        .context("Failed to create secure temporary directory")?;

    let report_path = tmp_dir.path().join("index.html");
    fs::write(&report_path, html_content)?;

    if !no_open {
        eprintln!("==> [tfview] Opening architecture diagram in your default browser...");
        opener::open(&report_path)
            .context("Failed to open default web browser. Try using '-o report.html' instead.")?;
    } else {
        eprintln!("==> [tfview] Ephemeral report generated at: {}", report_path.display());
    }

    eprintln!("\n👁️  Plan viewer active. Press [Enter] or Ctrl+C to close and shred all temporary files...");
    let mut exit_buf = String::new();

    if io::stdin().is_terminal() {
        let _ = io::stdin().read_line(&mut exit_buf);
    } else {
        #[cfg(unix)]
        {
            if let Ok(tty) = fs::File::open("/dev/tty") {
                let mut reader = io::BufReader::new(tty);
                let _ = io::BufRead::read_line(&mut reader, &mut exit_buf);
                return Ok(());
            }
        }
        // Fallback for non-interactive pipelines (CI, headless scripts):
        eprintln!("==> [tfview] Non-interactive stdin detected. Keeping ephemeral report active for 15s...");
        std::thread::sleep(std::time::Duration::from_secs(15));
    }

    Ok(())
}

fn handle_open(args: OpenArgs) -> Result<()> {
    let (plan_json, label) = if let Some(path) = &args.file {
        if path == Path::new("-") {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            (buf, "stdin plan".to_string())
        } else {
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "terraform plan".to_string());
            let content = fs::read_to_string(path)
                .with_context(|| format!("Failed to read plan JSON from '{}'", path.display()))?;
            (content, label)
        }
    } else if !io::stdin().is_terminal() {
        eprintln!("==> [tfview] Reading plan JSON from standard input...");
        let mut buf = String::new();
        io::stdin().read_to_string(&mut buf)?;
        (buf, "piped plan".to_string())
    } else {
        bail!("No plan JSON file provided. Usage: 'tfview open <PLAN_JSON>' or pipe via 'terraform show -json | tfview'");
    };

    let html = inject_plan(HTML_TEMPLATE, &plan_json, &label)?;
    present_report(html, args.output, args.no_open)
}

fn handle_plan(args: PlanArgs) -> Result<()> {
    let tmp_dir = Builder::new()
        .prefix("tfview-plan-")
        .tempdir()
        .context("Failed to create temporary directory for planning")?;

    let plan_json = generate_ephemeral_plan(args.offline, args.destroy, &args.terraform_args, tmp_dir.path())?;
    let html = inject_plan(HTML_TEMPLATE, &plan_json, "terraform plan")?;
    present_report(html, args.output, args.no_open)
}

async fn handle_explain(args: ExplainArgs) -> Result<()> {
    let (target_adapter, model) = resolve_model(args.provider.as_deref(), args.model.as_deref())?;
    let client = build_genai_client(target_adapter, args.api_key, args.endpoint);
    let resolved_adapter = target_adapter
        .or_else(|| AdapterKind::from_model(&model).ok())
        .unwrap_or(AdapterKind::Ollama);
    let provider_name = resolved_adapter.as_lower_str().to_string();

    let (plan_json, label) = if let Some(path) = &args.file {
        if path == Path::new("-") {
            let mut buf = String::new();
            io::stdin().read_to_string(&mut buf)?;
            (buf, "stdin plan".to_string())
        } else {
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "terraform plan".to_string());
            let content = fs::read_to_string(path)
                .with_context(|| format!("Failed to read plan JSON from '{}'", path.display()))?;
            (content, label)
        }
    } else {
        // No file provided: generate ephemeral plan safely (even in CI/non-interactive environments)
        let tmp_dir = Builder::new()
            .prefix("tfview-explain-")
            .tempdir()
            .context("Failed to create temporary directory for planning")?;
        let json = generate_ephemeral_plan(args.offline, args.destroy, &args.terraform_args, tmp_dir.path())?;
        (json, "terraform plan".to_string())
    };

    let mut plan_val: serde_json::Value = serde_json::from_str(&plan_json)
        .context("Input is not valid JSON. Ensure input is from 'terraform show -json'.")?;

    let (_total_res, target_resources) = match args.scope {
        ReviewScope::Changes => {
            let (tot, changed) = extract_changed_resources(&plan_val);
            eprintln!("==> [tfview] Found {} changed resources (out of {} total) for changes review.", changed.len(), tot);
            (tot, changed)
        }
        ReviewScope::Full => {
            let (tot, all_res) = extract_full_architecture(&plan_val);
            eprintln!("==> [tfview] Extracted {} total planned resources for full architecture review.", tot);
            (tot, all_res)
        }
    };

    // Explicit user egress notice
    let is_local = resolved_adapter == AdapterKind::Ollama;
    if is_local {
        eprintln!(
            "==> [tfview] Analyzing {} resources with local Ollama model '{}' (scope: {}, depth: {})...",
            target_resources.len(),
            model,
            args.scope,
            args.depth
        );
    } else {
        eprintln!(
            "==> [tfview] Sending {} redacted resources to remote provider '{}' (model: '{}', scope: {}, depth: {})...",
            target_resources.len(),
            provider_name,
            model,
            args.scope,
            args.depth
        );
    }

    let (llm_analysis, metrics) = run_llm_analysis(&client, &model, &target_resources, args.scope, args.depth).await?;

    if !args.json_stdout {
        print_terminal_summary(&llm_analysis, &metrics, &provider_name, &model, args.scope, args.depth);
    }

    enrich_plan_with_llm(&mut plan_val, &llm_analysis, &metrics, &provider_name, &model, args.scope, args.depth);
    let enriched_plan_json = serde_json::to_string_pretty(&plan_val)?;

    if let Some(json_path) = &args.json_out {
        fs::write(json_path, &enriched_plan_json)
            .with_context(|| format!("Failed to write enriched plan JSON to '{}'", json_path.display()))?;
        eprintln!("==> [tfview] Saved enriched plan JSON to: {}", json_path.display());
    }

    if args.json_stdout {
        println!("{}", enriched_plan_json);
        return Ok(());
    }

    let html = inject_plan(HTML_TEMPLATE, &enriched_plan_json, &label)?;
    present_report(html, args.output, args.no_open)
}

#[tokio::main]
async fn main() -> Result<()> {
    if env::args().len() == 1 && !io::stdin().is_terminal() {
        return handle_open(OpenArgs {
            file: None,
            output: None,
            no_open: false,
        });
    }

    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Plan(args)) => handle_plan(args),
        Some(Commands::Open(args)) => handle_open(args),
        Some(Commands::Explain(args)) => handle_explain(args).await,
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_plan_escapes_script_breakout_xss() {
        let template = r#"<!DOCTYPE html><html><head><script type="application/json" id="embedded-plan">{}</script></head><body></body></html>"#;
        let malicious_plan = r#"{"user_data": "echo </script><script>alert(1)</script>"}"#;

        let injected = inject_plan(template, malicious_plan, "test-plan").unwrap();

        // Must NOT contain literal </script> inside the embedded-plan content
        let start_pos = injected.find(r#"id="embedded-plan">"#).unwrap();
        let end_pos = injected.find(r#"</script>"#).unwrap();
        let script_content = &injected[start_pos..end_pos];

        assert!(!script_content.contains("</script>"));
        assert!(script_content.contains(r#"\u003c/script>"#));

        // When parsed as JSON, it recovers the original string verbatim
        let json_extracted = script_content.trim_start_matches(r#"id="embedded-plan">"#);
        let parsed: serde_json::Value = serde_json::from_str(json_extracted).unwrap();
        assert_eq!(parsed["user_data"], "echo </script><script>alert(1)</script>");
    }

    #[test]
    fn test_inject_plan_embeds_autoload_marker() {
        let template = r#"<!DOCTYPE html><html><head><script type="application/json" id="embedded-plan">{}</script></head><body></body></html>"#;
        let plan = r#"{"format_version": "1.0"}"#;

        let injected = inject_plan(template, plan, "my-production-plan").unwrap();

        assert!(injected.contains("window.__TFVIEW_AUTOLOAD = true;"));
        assert!(injected.contains(r#"window.__TFVIEW_PLAN_LABEL = "my-production-plan";"#));
    }

    #[test]
    fn test_inject_plan_escapes_label_breakout_xss() {
        let template = r#"<!DOCTYPE html><html><head><script type="application/json" id="embedded-plan">{}</script></head><body></body></html>"#;
        let plan = r#"{"format_version": "1.0"}"#;
        let malicious_label = r#"</script><script>alert('xss')</script>"#;

        let injected = inject_plan(template, plan, malicious_label).unwrap();

        // Must NOT contain literal unescaped </script> inside the autoload script
        assert!(!injected.contains("</script><script>alert('xss')"));
        assert!(injected.contains(r#"\u003c/script>\u003cscript>alert('xss')\u003c/script>"#));
    }

    #[test]
    fn test_validate_ephemeral_plan_args_rejects_out() {
        assert!(validate_ephemeral_plan_args(&["-out=plan.bin".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["--out=plan.bin".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["-out".to_string(), "plan.bin".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["--out".to_string(), "plan.bin".to_string()]).is_err());
    }

    #[test]
    fn test_validate_ephemeral_plan_args_rejects_lock() {
        assert!(validate_ephemeral_plan_args(&["-lock=true".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["--lock=true".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["-lock=false".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["-lock".to_string()]).is_err());
        assert!(validate_ephemeral_plan_args(&["--lock".to_string()]).is_err());
    }

    #[test]
    fn test_validate_ephemeral_plan_args_accepts_valid() {
        let valid_args = vec![
            "-var=env=prod".to_string(),
            "-target=aws_s3_bucket.main".to_string(),
            "-parallelism=10".to_string(),
            "-lock-timeout=10s".to_string(),
        ];
        assert!(validate_ephemeral_plan_args(&valid_args).is_ok());
    }
}
