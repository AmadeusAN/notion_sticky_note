use crate::models::{ExitSaveState, ExitSaveStatus};
use std::sync::Mutex;

#[derive(Default)]
pub struct ExitCoordinator {
    state: Mutex<ExitSaveState>,
}

impl ExitCoordinator {
    pub fn snapshot(&self) -> Result<ExitSaveState, String> {
        self.state.lock().map(|state| state.clone()).map_err(|_| crate::language::text("Unable to read the exit save state.", "无法读取退出保存状态").into())
    }

    pub fn begin(&self) -> Result<Option<ExitSaveState>, String> {
        let mut state = self.state.lock().map_err(|_| crate::language::text("Unable to update the exit save state.", "无法更新退出保存状态").to_string())?;
        if state.status == ExitSaveStatus::Saving { return Ok(None); }
        state.revision = state.revision.checked_add(1).ok_or_else(|| crate::language::text("The exit request counter is exhausted. Choose to discard unsaved settings and quit.", "退出请求版本已满，请选择放弃未保存设置退出").to_string())?;
        state.status = ExitSaveStatus::Saving;
        Ok(Some(state.clone()))
    }

    pub fn cancel(&self) -> Result<ExitSaveState, String> {
        let mut state = self.state.lock().map_err(|_| crate::language::text("Unable to cancel the exit request.", "无法取消退出请求").to_string())?;
        state.revision = state.revision.saturating_add(1);
        state.status = ExitSaveStatus::Idle;
        state.error = None;
        Ok(state.clone())
    }

    pub fn finish(&self, revision: u64, result: Result<(), String>) -> Result<Option<ExitSaveState>, String> {
        let mut state = self.state.lock().map_err(|_| crate::language::text("Unable to confirm the exit save result.", "无法确认退出保存结果").to_string())?;
        if state.revision != revision || state.status != ExitSaveStatus::Saving { return Ok(None); }
        match result {
            Ok(()) => { state.status = ExitSaveStatus::Idle; state.error = None; }
            Err(error) => { state.status = ExitSaveStatus::Error; state.error = Some(error); }
        }
        Ok(Some(state.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_exit_requests_share_one_flush_attempt() {
        let exit = ExitCoordinator::default();
        let first = exit.begin().unwrap().unwrap();
        assert!(exit.begin().unwrap().is_none());
        let result = exit.finish(first.revision, Ok(())).unwrap().unwrap();
        assert_eq!(result.status, ExitSaveStatus::Idle);
        assert!(result.error.is_none());
    }

    #[test]
    fn failed_flush_remains_actionable_and_retry_keeps_the_dialog_context() {
        let exit = ExitCoordinator::default();
        let first = exit.begin().unwrap().unwrap();
        let failed = exit.finish(first.revision, Err("保存失败".into())).unwrap().unwrap();
        assert_eq!(failed.status, ExitSaveStatus::Error);
        let retry = exit.begin().unwrap().unwrap();
        assert!(retry.revision > failed.revision);
        assert_eq!(retry.error.as_deref(), Some("保存失败"));
        let saved = exit.finish(retry.revision, Ok(())).unwrap().unwrap();
        assert_eq!(saved.status, ExitSaveStatus::Idle);
        assert!(saved.error.is_none());
    }

    #[test]
    fn cancelled_exit_cannot_be_reopened_or_completed_by_a_late_flush() {
        let exit = ExitCoordinator::default();
        let first = exit.begin().unwrap().unwrap();
        let cancelled = exit.cancel().unwrap();
        assert!(cancelled.revision > first.revision);
        assert!(exit.finish(first.revision, Err("迟到的失败".into())).unwrap().is_none());
        assert!(exit.finish(first.revision, Ok(())).unwrap().is_none());
        assert_eq!(exit.snapshot().unwrap().status, ExitSaveStatus::Idle);
    }

    #[test]
    fn a_late_result_cannot_clear_a_newer_retry_error() {
        let exit = ExitCoordinator::default();
        let first = exit.begin().unwrap().unwrap();
        exit.finish(first.revision, Err("第一次失败".into())).unwrap();
        let retry = exit.begin().unwrap().unwrap();
        exit.finish(retry.revision, Err("仍未保存".into())).unwrap();
        assert!(exit.finish(first.revision, Ok(())).unwrap().is_none());
        assert_eq!(exit.snapshot().unwrap().error.as_deref(), Some("仍未保存"));
    }
}
