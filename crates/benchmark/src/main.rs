#[cfg(not(feature = "probe-bindings"))]
mod bindings;
#[cfg(feature = "probe-bindings")]
#[rustfmt::skip]
#[path = "probe_bindings/mod.rs"]
mod bindings;
mod client;
mod explore;
mod runner;

fn main() {
    match execute() {
        Ok(true) => {}
        Ok(false) => std::process::exit(2),
        Err(error) => {
            eprintln!("Benchmark failed: {error}");
            std::process::exit(1);
        }
    }
}

fn execute() -> client::Result<bool> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() % 2 != 0 {
        return Err("arguments are --name value pairs".into());
    }
    let args: std::collections::HashMap<_, _> = args
        .chunks_exact(2)
        .map(|a| (a[0].as_str(), a[1].as_str()))
        .collect();
    let required = |key: &str| {
        args.get(key)
            .map(|s| s.to_string())
            .ok_or_else(|| format!("missing {key}"))
    };
    let environment = required("--environment")?;
    if environment != "LOCAL" && environment != "MAINCLOUD" {
        return Err("environment must be LOCAL or MAINCLOUD".into());
    }
    let uri = required("--uri")?;
    if environment == "MAINCLOUD" && args.get("--authorized-maincloud") != Some(&"yes") {
        return Err("explicit development Maincloud authorization required".into());
    }
    if environment == "LOCAL"
        && ![
            "http://db:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ]
        .contains(&uri.as_str())
    {
        return Err("LOCAL qualification requires the local runtime URI".into());
    }
    let token = match std::env::var("SPACETIMEDB_TOKEN") {
        Ok(token) => token,
        Err(_) => {
            let file = required("--token-file")?;
            let config = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
            config
                .lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix("spacetimedb_token = ")
                        .map(|s| s.trim_matches('"').to_string())
                })
                .ok_or("publishing token missing")?
        }
    };
    let exploration = if args.get("--mode") == Some(&"explore") {
        if environment != "LOCAL" {
            return Err("exploration is local-only".into());
        }
        Some(explore::Window::new(
            required("--warmup-seconds")?
                .parse()
                .map_err(|_| "invalid warmup")?,
            required("--measurement-seconds")?
                .parse()
                .map_err(|_| "invalid measurement")?,
            required("--repeats")?
                .parse()
                .map_err(|_| "invalid repeats")?,
        )?)
    } else {
        if args.get("--mode").is_some_and(|s| *s != "qualify") {
            return Err("mode must be qualify or explore".into());
        }
        None
    };
    runner::run(runner::Options {
        uri,
        database: required("--database")?,
        token,
        build_hash: required("--build-hash")?,
        population: required("--population")?
            .parse::<u64>()
            .map_err(|e| e.to_string())?,
        profile: required("--profile")?,
        cadence_profile: args.get("--cadence").map_or_else(
            || one_market_core::config::config().default_cadence,
            |s| s.to_string(),
        ),
        environment,
        output: required("--output")?.into(),
        exploration,
    })
}
