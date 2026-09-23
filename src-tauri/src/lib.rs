use std::{net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream}, sync::Mutex, thread, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct BackendProcess(Mutex<Option<CommandChild>>);

fn available_loopback_port() -> std::io::Result<u16> {
  Ok(TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?.local_addr()?.port())
}

fn wait_for_backend(port: u16) -> Result<(), String> {
  let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
  let deadline = Instant::now() + Duration::from_secs(20);
  while Instant::now() < deadline {
    if TcpStream::connect_timeout(&address.into(), Duration::from_millis(250)).is_ok() {
      return Ok(());
    }
    thread::sleep(Duration::from_millis(150));
  }
  Err("El backend local no respondió dentro del tiempo esperado".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let application = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let data_dir = app.path().app_data_dir()?;
      let resource_dir = app.path().resource_dir()?;
      let frontend_dir = resource_dir.join("frontend");
      let backend_script = resource_dir.join("backend").join("spl-backend.cjs");
      let port = available_loopback_port()?;
      std::fs::create_dir_all(&data_dir)?;
      let (mut receiver, child) = app.shell().sidecar("spl-node")?
        .arg(backend_script)
        .env("SPL_DATA_DIR", data_dir)
        .env("SPL_FRONTEND_DIR", frontend_dir)
        .env("PORT", port.to_string())
        .env("SPL_PARENT_PID", std::process::id().to_string())
        .env("NODE_ENV", "production")
        .spawn()?;
      app.manage(BackendProcess(Mutex::new(Some(child))));
      tauri::async_runtime::spawn(async move {
        while receiver.recv().await.is_some() {}
      });
      wait_for_backend(port).map_err(std::io::Error::other)?;
      let application_url = format!("http://127.0.0.1:{port}").parse()?;
      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(application_url))
        .title("SPL Control Financiero")
        .inner_size(1440.0, 900.0)
        .min_inner_size(820.0, 640.0)
        .center()
        .build()?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("no se pudo construir la aplicación SPL");

  application.run(|handle, event| {
    if matches!(event, tauri::RunEvent::Exit) {
      if let Some(child) = handle.state::<BackendProcess>().0.lock().expect("backend lock poisoned").take() {
        let _ = child.kill();
      }
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn chooses_an_unprivileged_loopback_port() {
    let port = available_loopback_port().expect("a loopback port should be available");
    assert!(port > 1024);
  }
}
