mod app;
mod compat;
mod config;
mod controller;
mod data;
mod storage;
mod view_models;

slint::include_modules!();

fn main() {
    if let Err(error) = app::run() {
        eprintln!("distill-desktop failed: {error:?}");
        std::process::exit(1);
    }
}
