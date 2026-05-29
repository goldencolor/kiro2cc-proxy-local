use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde_json::json;

#[derive(Debug, Clone)]
struct WecomWebhookConfig {
    url: Option<String>,
    cooldown_secs: u64,
}

#[derive(Debug)]
struct AlertState {
    config: WecomWebhookConfig,
    last_all_unavailable_sent_at: Option<Instant>,
}

static ALERT_STATE: OnceLock<Mutex<AlertState>> = OnceLock::new();

fn state() -> &'static Mutex<AlertState> {
    ALERT_STATE.get_or_init(|| {
        Mutex::new(AlertState {
            config: WecomWebhookConfig {
                url: None,
                cooldown_secs: 1800,
            },
            last_all_unavailable_sent_at: None,
        })
    })
}

pub fn set_wecom_webhook_config(url: Option<String>, cooldown_secs: u64) {
    let mut state = state().lock();
    state.config = WecomWebhookConfig {
        url: url.and_then(|v| {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        cooldown_secs: cooldown_secs.max(60),
    };
}

pub fn get_wecom_webhook_config() -> (Option<String>, u64) {
    let state = state().lock();
    (state.config.url.clone(), state.config.cooldown_secs)
}

pub fn notify_all_credentials_unavailable(reason: impl Into<String>) {
    let reason = reason.into();
    let (url, cooldown_secs) = {
        let mut state = state().lock();
        let Some(url) = state.config.url.clone() else {
            return;
        };

        let cooldown_secs = state.config.cooldown_secs.max(60);
        let cooldown = Duration::from_secs(cooldown_secs);
        if state
            .last_all_unavailable_sent_at
            .is_some_and(|last| last.elapsed() < cooldown)
        {
            tracing::debug!("全部账号不可用预警仍在冷却中，跳过本次推送");
            return;
        }

        state.last_all_unavailable_sent_at = Some(Instant::now());
        (url, cooldown_secs)
    };

    tokio::spawn(async move {
        if let Err(e) = send_wecom_text(&url, &reason).await {
            tracing::warn!("企业微信全部账号不可用预警推送失败: {}", e);
        } else {
            tracing::warn!(
                cooldown_secs = cooldown_secs,
                "已推送企业微信全部账号不可用预警"
            );
        }
    });
}

async fn send_wecom_text(webhook_url: &str, reason: &str) -> anyhow::Result<()> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let content = format!(
        "【kiro2cc 预警】全部上游账号不可用\n时间：{}\n原因：{}\n请尽快登录管理后台检查账号状态、额度和认证信息。",
        now, reason
    );
    let payload = json!({
        "msgtype": "text",
        "text": {
            "content": content,
        }
    });

    let response = reqwest::Client::new()
        .post(webhook_url)
        .json(&payload)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("HTTP {}: {}", status, body);
    }

    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
    let errcode = parsed
        .get("errcode")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if errcode != 0 {
        anyhow::bail!("企业微信返回错误: {}", body);
    }

    Ok(())
}
