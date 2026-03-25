#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if grove_lib::should_run_cli() {
        grove_lib::cli_main();
    } else {
        grove_lib::run();
    }
}
