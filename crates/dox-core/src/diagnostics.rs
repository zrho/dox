use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
    Proposal,
}

/// A description of a future suggested action, never an instruction to execute it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticAction {
    pub kind: String,
    pub title: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub id: String,
    pub severity: Severity,
    pub code: String,
    pub message: String,
    pub note_id: Option<String>,
    pub document: Option<String>,
    /// One-based source coordinates, when supplied by the compiler.
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub target_note_id: Option<String>,
    #[serde(default)]
    pub actions: Vec<DiagnosticAction>,
}
impl Diagnostic {
    pub fn new(
        severity: Severity,
        code: &str,
        note_id: &str,
        document: Option<&str>,
        message: impl Into<String>,
    ) -> Self {
        let message = message.into();
        Self {
            id: crate::digest(
                format!("{severity:?}:{code}:{note_id}:{document:?}:{message}").as_bytes(),
            ),
            severity,
            code: code.into(),
            message,
            note_id: Some(note_id.into()),
            document: document.map(str::to_owned),
            line: None,
            column: None,
            target_note_id: None,
            actions: vec![],
        }
    }
}
