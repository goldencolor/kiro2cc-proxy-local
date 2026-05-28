use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use std::sync::Arc;

use crate::kiro::token_manager::MultiTokenManager;
use crate::model::config::Config;

#[derive(Clone)]
pub struct HealthState {
    pub config: Config,
    pub token_manager: Arc<MultiTokenManager>,
    pub admin_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyResponse {
    status: &'static str,
    credentials_total: usize,
    credentials_available: usize,
    load_balancing_mode: String,
    api_region: String,
    auth_region: String,
    endpoint_family: String,
    admin_enabled: bool,
    issues: Vec<String>,
}

static STARTED_AT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

pub fn create_router(state: HealthState) -> Router {
    STARTED_AT.get_or_init(std::time::Instant::now);
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .with_state(state)
}

async fn health() -> Json<HealthResponse> {
    let uptime_seconds = STARTED_AT
        .get()
        .map(|started| started.elapsed().as_secs())
        .unwrap_or(0);

    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_seconds,
    })
}

async fn ready(State(state): State<HealthState>) -> Response {
    let total = state.token_manager.total_count();
    let available = state.token_manager.available_count();
    let mut issues = Vec::new();

    if total == 0 {
        issues.push("No credentials or Kiro API key configured".to_string());
    }
    if available == 0 {
        issues.push("No available upstream credentials".to_string());
    }

    let status = if issues.is_empty() {
        "ready"
    } else {
        "degraded"
    };
    let code = if issues.is_empty() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        code,
        Json(ReadyResponse {
            status,
            credentials_total: total,
            credentials_available: available,
            load_balancing_mode: state.token_manager.get_load_balancing_mode(),
            api_region: state.config.effective_api_region().to_string(),
            auth_region: state.config.effective_auth_region().to_string(),
            endpoint_family: format!("{:?}", state.config.endpoint_family),
            admin_enabled: state.admin_enabled,
            issues,
        }),
    )
        .into_response()
}
