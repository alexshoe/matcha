use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub content: String, // Tiptap JSON serialized as a string
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default = "default_list")]
    pub list: String,
    #[serde(default)]
    pub deleted: bool,
    pub deleted_at: Option<u64>,
}

fn default_list() -> String {
    "My Notes".to_string()
}

pub struct AppState {
    pub notes: Mutex<Vec<Note>>,
    pub file_path: PathBuf,
}

fn load_notes(path: &PathBuf) -> Vec<Note> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_notes(path: &PathBuf, notes: &[Note]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
fn get_notes(state: tauri::State<AppState>) -> Result<Vec<Note>, String> {
    let notes = state.notes.lock().map_err(|e| e.to_string())?;
    Ok(notes.clone())
}

#[tauri::command]
fn create_note(state: tauri::State<AppState>, list: String) -> Result<Note, String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    let now = now_unix();
    let note = Note {
        id: Uuid::new_v4().to_string(),
        content: String::new(),
        created_at: now,
        updated_at: now,
        pinned: false,
        list,
        deleted: false,
        deleted_at: None,
    };
    notes.push(note.clone());
    save_notes(&state.file_path, &notes)?;
    Ok(note)
}

#[tauri::command]
fn update_note(
    state: tauri::State<AppState>,
    id: String,
    content: String,
) -> Result<Note, String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or_else(|| format!("Note {} not found", id))?;
    note.content = content;
    note.updated_at = now_unix();
    let note = note.clone();
    save_notes(&state.file_path, &notes)?;
    Ok(note)
}

#[tauri::command]
fn update_note_list(
    state: tauri::State<AppState>,
    old_list: String,
    new_list: String,
) -> Result<(), String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    for note in notes.iter_mut() {
        if note.list == old_list {
            note.list = new_list.clone();
        }
    }
    save_notes(&state.file_path, &notes)
}

#[tauri::command]
fn pin_note(state: tauri::State<AppState>, id: String, pinned: bool) -> Result<Note, String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or_else(|| format!("Note {} not found", id))?;
    note.pinned = pinned;
    let note = note.clone();
    save_notes(&state.file_path, &notes)?;
    Ok(note)
}

#[tauri::command]
fn soft_delete_note(state: tauri::State<AppState>, id: String) -> Result<Note, String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or_else(|| format!("Note {} not found", id))?;
    note.deleted = true;
    note.deleted_at = Some(now_unix());
    note.pinned = false;
    let note = note.clone();
    save_notes(&state.file_path, &notes)?;
    Ok(note)
}

#[tauri::command]
fn restore_note(state: tauri::State<AppState>, id: String) -> Result<Note, String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    let note = notes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or_else(|| format!("Note {} not found", id))?;
    note.deleted = false;
    note.deleted_at = None;
    let note = note.clone();
    save_notes(&state.file_path, &notes)?;
    Ok(note)
}

#[tauri::command]
fn delete_note(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let mut notes = state.notes.lock().map_err(|e| e.to_string())?;
    notes.retain(|n| n.id != id);
    save_notes(&state.file_path, &notes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let file_path = data_dir.join("notes.json");
            let notes = load_notes(&file_path);
            app.manage(AppState {
                notes: Mutex::new(notes),
                file_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes,
            create_note,
            update_note,
            update_note_list,
            pin_note,
            soft_delete_note,
            restore_note,
            delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
