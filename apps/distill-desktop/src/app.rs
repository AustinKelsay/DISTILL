use std::path::PathBuf;

use anyhow::{Context, Result};
use slint::ComponentHandle;

use crate::AppWindow;
use crate::controller::DesktopController;
use crate::view_models::{DataSourceConfig, DataSourceMode};

pub fn run() -> Result<()> {
    let ui = AppWindow::new().context("failed to create Slint window")?;
    let distill_home = resolve_distill_home()?;
    let prefs_path = resolve_prefs_path()?;
    let controller = DesktopController::new(
        &ui,
        DataSourceConfig {
            distill_home,
            mode: DataSourceMode::ElectronCompatReadOnly,
        },
        prefs_path,
    );
    let _controller = controller;

    ui.run().context("desktop window exited with an error")
}

fn resolve_distill_home() -> Result<PathBuf> {
    if let Some(value) = std::env::var_os("DISTILL_ELECTRON_HOME") {
        return Ok(PathBuf::from(value));
    }

    let home = dirs::home_dir().context("home directory is unavailable")?;
    Ok(home.join(".distill-electron"))
}

fn resolve_prefs_path() -> Result<PathBuf> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .context("no app data directory is available")?;
    Ok(base.join("distill-desktop").join("preferences.json"))
}
