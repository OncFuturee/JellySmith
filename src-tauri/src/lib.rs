mod ai;
mod app_log;
mod audit;
mod media_probe;
mod portable;
mod settings;
mod tasks;
mod tmdb;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("main window configuration is missing")?;
            let webview_directory = portable::directory("webview")?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .data_directory(webview_directory)
                .build()?;
            let _ = app_log::record(app.handle(), "INFO", "application", "JellySmith started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_log::list_application_logs,
            app_log::write_application_log,
            app_log::clear_application_logs,
            tasks::select_directory,
            audit::list_runs,
            media_probe::probe_media,
            settings::load_settings,
            settings::save_settings,
            settings::has_api_key,
            settings::save_api_key,
            ai::list_ai_models,
            ai::propose_ai_grouping,
            ai::propose_ai_episode_mappings,
            tasks::create_organizer_task,
            tasks::list_organizer_tasks,
            tasks::load_organizer_task,
            tasks::archive_organizer_task,
            tasks::update_organizer_task_source,
            tasks::update_organizer_task_config,
            tasks::scan_organizer_task,
            tasks::cancel_organizer_scan,
            tasks::confirm_scan_selection,
            tasks::group_organizer_task,
            tasks::update_media_group,
            tasks::delete_media_group,
            tasks::create_media_group,
            tasks::move_files_to_group,
            tasks::apply_ai_grouping,
            tasks::confirm_tmdb_match,
            tasks::confirm_manual_match,
            tasks::update_episode_mappings,
            tasks::update_episode_naming_format,
            tasks::generate_organization_plan,
            tasks::update_plan_operation,
            tasks::execute_organization_plan,
            audit::delete_run,
            tmdb::search_tmdb,
            tmdb::get_tmdb_details,
            tmdb::get_tmdb_image_color,
            tmdb::get_tmdb_image_palette,
            tmdb::get_tmdb_season,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run JellySmith");
}
