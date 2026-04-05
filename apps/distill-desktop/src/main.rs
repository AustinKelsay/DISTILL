mod app;
mod controller;
mod data;
mod view_models;

slint::include_modules!();

fn main() {
    if let Err(error) = app::run() {
        eprintln!("distill-desktop failed: {error:?}");
        std::process::exit(1);
    }
}
