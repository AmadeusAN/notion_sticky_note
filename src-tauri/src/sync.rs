use crate::database::Database;
use crate::models::Task;
use crate::notion::NotionClient;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

pub struct SyncEngine {
    db: Arc<Database>,
    notion: NotionClient,
    lock: Mutex<()>,
}

impl SyncEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            notion: NotionClient::new(),
            lock: Mutex::new(()),
        }
    }

    pub async fn sync_once(&self) -> Result<String, String> {
        let _guard = self.lock.lock().await;
        let settings = self.db.load_settings()?;
        let config = settings.notion;

        if config.token.trim().is_empty() || config.database_id.trim().is_empty() {
            self.db.seed_mocks_if_empty()?;
            return Ok("using-local-mocks".into());
        }

        // Flush pending local checkbox writes first
        for (op_id, task_id, completed) in self.db.list_pending()? {
            if let Some(task) = self.db.get_task(&task_id)? {
                if let Some(page_id) = task.notion_id.clone() {
                    match self.notion.set_done(&config, &page_id, completed).await {
                        Ok(()) => self.db.clear_pending(op_id)?,
                        Err(e) => {
                            let _ = self.db.log_sync(&format!("pending flush failed: {e}"));
                            break;
                        }
                    }
                } else {
                    self.db.clear_pending(op_id)?;
                }
            } else {
                self.db.clear_pending(op_id)?;
            }
        }

        let remote = self.notion.query_tasks(&config).await?;
        let local = self.db.list_tasks()?;

        let mut merged: Vec<Task> = Vec::new();
        for remote_task in remote {
            if let Some(local_task) = local.iter().find(|t| {
                t.notion_id.as_ref() == remote_task.notion_id.as_ref()
                    || t.id == remote_task.id
            }) {
                // Prefer newer updated_time; keep local completed if newer
                if local_task.updated_time > remote_task.updated_time {
                    merged.push(local_task.clone());
                } else {
                    merged.push(remote_task);
                }
            } else {
                merged.push(remote_task);
            }
        }

        self.db.replace_tasks(&merged)?;
        self.db.log_sync(&format!("synced {} tasks", merged.len()))?;
        Ok(format!("ok:{}", merged.len()))
    }

    pub async fn spawn_polling(self: Arc<Self>) {
        tokio::spawn(async move {
            // Initial sync shortly after launch
            tokio::time::sleep(Duration::from_secs(2)).await;
            let _ = self.sync_once().await;
            loop {
                let configured = self
                    .db
                    .load_settings()
                    .map(|s| {
                        !s.notion.token.trim().is_empty()
                            && !s.notion.database_id.trim().is_empty()
                    })
                    .unwrap_or(false);
                // Back off when Notion is not configured to keep idle CPU/network near zero
                let wait = if configured {
                    Duration::from_secs(30)
                } else {
                    Duration::from_secs(120)
                };
                tokio::time::sleep(wait).await;
                let _ = self.sync_once().await;
            }
        });
    }
}
