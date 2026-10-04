fn main() {
    // Preserved baseline WASMs generate a different private schema. Detect the
    // selected generated module, not a possibly stale generated table file.
    println!("cargo:rustc-check-cfg=cfg(has_compact_actor_storage)");
    println!("cargo:rustc-check-cfg=cfg(has_cadence_profiles)");
    let directory = if std::env::var_os("CARGO_FEATURE_PROBE_BINDINGS").is_some() {
        "probe_bindings"
    } else {
        "bindings"
    };
    let path = format!("src/{directory}/mod.rs");
    println!("cargo:rerun-if-changed={path}");
    let module =
        std::fs::read_to_string(path).expect("generate benchmark bindings before building");
    if module.contains("mod actor_state_compact_table;") {
        println!("cargo:rustc-cfg=has_compact_actor_storage");
    }
    if module.contains("mod set_cadence_profile_reducer;") {
        println!("cargo:rustc-cfg=has_cadence_profiles");
    }
}
