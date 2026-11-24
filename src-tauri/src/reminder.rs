use crate::database::Database;
use crate::models::Task;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

const POLL_INTERVAL: Duration = Duration::from_secs(15);

pub struct ReminderEngine {
    db: Arc<Database>,
    wakeup: Notify,
    stopped: AtomicBool,
}

impl ReminderEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            wakeup: Notify::new(),
            stopped: AtomicBool::new(false),
        }
    }

    pub fn start(self: Arc<Self>, on_fired: impl Fn(&Task) + Send + Sync + 'static) {
        let on_fired = Arc::new(on_fired);
        tauri::async_runtime::spawn(async move {
            self.run_loop(move |task| {
                notify_os(task);
                on_fired(task);
            })
            .await;
        });
    }

    pub fn wake(&self) {
        self.wakeup.notify_one();
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.wakeup.notify_waiters();
    }

    async fn run_loop(&self, on_fired: impl Fn(&Task) + Send + Sync) {
        loop {
            if self.stopped.load(Ordering::SeqCst) {
                break;
            }
            let now_ms = chrono::Utc::now().timestamp_millis();
            if let Err(err) = self.process_due(now_ms, &on_fired) {
                eprintln!("Reminder check failed: {err}");
            }
            if self.stopped.load(Ordering::SeqCst) {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep(POLL_INTERVAL) => {}
                _ = self.wakeup.notified() => {}
            }
        }
    }

    pub fn process_due(&self, now_ms: i64, on_fired: &impl Fn(&Task)) -> Result<Vec<Task>, String> {
        let due = self.db.due_reminders(now_ms)?;
        let mut fired = Vec::new();
        for mut task in due {
            if self.db.mark_reminded(&task.id, now_ms)? {
                task.reminded_at = Some(now_ms);
                on_fired(&task);
                fired.push(task);
            }
        }
        Ok(fired)
    }
}

pub fn format_notification_body(task: &Task) -> String {
    let prefix = crate::language::text("Sticky Note Reminder", "便签任务提醒");
    match task.date.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(schedule) => format!("{prefix} · {schedule}"),
        None => prefix.to_string(),
    }
}

#[cfg(windows)]
fn notify_os(task: &Task) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const POWERSHELL_AUMID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

    let title = task.title.clone();
    let body = format_notification_body(task);
    std::thread::spawn(move || {
        let script = concat!(
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;",
            "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;",
            "$t = [System.Security.SecurityElement]::Escape($env:STICKY_TOAST_TITLE);",
            "$b = [System.Security.SecurityElement]::Escape($env:STICKY_TOAST_BODY);",
            "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;",
            "$xml.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>\");",
            "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml;",
            "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:STICKY_TOAST_APP).Show($toast);"
        );
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("STICKY_TOAST_APP", POWERSHELL_AUMID)
        .env("STICKY_TOAST_TITLE", title)
        .env("STICKY_TOAST_BODY", body)
        .creation_flags(CREATE_NO_WINDOW);
        match cmd.status() {
            Ok(status) if !status.success() => {
                eprintln!("Windows toast script exited with status: {status}");
            }
            Err(error) => {
                eprintln!("Failed to launch Windows toast notification: {error}");
            }
            _ => {}
        }
    });
}

#[cfg(not(windows))]
fn notify_os(_task: &Task) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{TaskScheduleInput, TaskUpdateInput};
    use std::sync::Mutex;

    fn test_db() -> Arc<Database> {
        let path = std::env::temp_dir().join(format!(
            "sticky-reminder-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        Arc::new(Database::open(path).unwrap())
    }

    #[test]
    fn reminder_engine_fires_once_and_formats_schedule_body() {
        let db = test_db();
        let imported = db
            .import_local_tasks_with_schedule(
                vec!["Submit <report> & slides".into()],
                None,
                Some("Work"),
                Some(TaskScheduleInput {
                    start_date: Some("2026-11-24".into()),
                    end_date: None,
                    start_time: Some("14:30".into()),
                    end_time: None,
                    reminder_at: Some(5_000),
                }),
            )
            .unwrap();
        let task = &imported.tasks[0];
        let body = format_notification_body(task);
        assert!(body.contains("2026-11-24 14:30"));

        let engine = ReminderEngine::new(db.clone());
        let seen = Mutex::new(Vec::new());
        let fired = engine.process_due(5_000, &|t| seen.lock().unwrap().push(t.id.clone())).unwrap();
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].reminded_at, Some(5_000));

        // Second check must not fire again.
        let second = engine.process_due(6_000, &|t| seen.lock().unwrap().push(t.id.clone())).unwrap();
        assert!(second.is_empty());
        assert_eq!(seen.lock().unwrap().len(), 1);

        // Rescheduling re-arms the reminder.
        db.update_local_task(
            &task.id,
            TaskUpdateInput {
                update_schedule: true,
                start_date: Some("2026-11-24".into()),
                reminder_at: Some(8_000),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(engine.process_due(7_000, &|t| seen.lock().unwrap().push(t.id.clone())).unwrap().is_empty());
        let rearmed = engine.process_due(8_000, &|t| seen.lock().unwrap().push(t.id.clone())).unwrap();
        assert_eq!(rearmed.len(), 1);
        assert_eq!(seen.lock().unwrap().len(), 2);
    }
}
