//! Admin API 业务逻辑服务

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::kiro::model::credentials::KiroCredentials;
use crate::kiro::token_manager::MultiTokenManager;

use super::error::AdminServiceError;
use super::types::{
    AddCredentialRequest, AddCredentialResponse, AlertConfigResponse, BalanceResponse,
    CredentialStatusItem, CredentialsStatusResponse, KvCacheConfigResponse,
    LoadBalancingModeResponse, ProbeCredentialResult, ProbeCredentialsRequest,
    ProbeCredentialsResponse, RequestDetailItem, RequestDetailsResponse, SetAlertConfigRequest,
    SetKvCacheConfigRequest, SetLoadBalancingModeRequest, UpdateCredentialRequest,
};

/// 余额缓存过期时间（秒），5 分钟
const BALANCE_CACHE_TTL_SECS: i64 = 300;
const REQUEST_DETAILS_DEFAULT_LIMIT: usize = 100;
const REQUEST_DETAILS_MAX_LIMIT: usize = 1000;
const KV_CACHE_RECORDS_FILE: &str = "kiro_kv_cache_records.jsonl";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KvCacheRecordRow {
    recorded_at: String,
    request_id: String,
    endpoint: String,
    model: String,
    #[serde(default)]
    credential_id: u64,
    stream: bool,
    cache_hit: bool,
    cache_creation_input_tokens: i32,
    cache_read_input_tokens: i32,
    input_tokens: i32,
    output_tokens: i32,
    #[serde(default)]
    credits_used: f64,
    #[serde(default)]
    special_settings: Vec<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    latency_ms: Option<u128>,
    #[serde(default)]
    client_ip: Option<String>,
    #[serde(default)]
    request_body: Option<serde_json::Value>,
    #[serde(default)]
    response_body: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy)]
struct ModelPricing {
    input_per_million: f64,
    output_per_million: f64,
    cache_write_per_million: f64,
    cache_read_per_million: f64,
}

/// 缓存的余额条目（含时间戳）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedBalance {
    /// 缓存时间（Unix 秒）
    cached_at: f64,
    /// 缓存的余额数据
    data: BalanceResponse,
}

/// Admin 服务
///
/// 封装所有 Admin API 的业务逻辑
pub struct AdminService {
    token_manager: Arc<MultiTokenManager>,
    balance_cache: Mutex<HashMap<u64, CachedBalance>>,
    cache_path: Option<PathBuf>,
    request_details_path: PathBuf,
}

impl AdminService {
    pub fn new(token_manager: Arc<MultiTokenManager>) -> Self {
        let cache_path = token_manager
            .cache_dir()
            .map(|d| d.join("kiro_balance_cache.json"));
        let cache_dir = token_manager
            .cache_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let request_details_path = cache_dir.join(KV_CACHE_RECORDS_FILE);

        let balance_cache = Self::load_balance_cache_from(&cache_path);

        Self {
            token_manager,
            balance_cache: Mutex::new(balance_cache),
            cache_path,
            request_details_path,
        }
    }

    /// 获取所有凭据状态
    pub fn get_all_credentials(&self) -> CredentialsStatusResponse {
        let snapshot = self.token_manager.snapshot();

        let mut credentials: Vec<CredentialStatusItem> = snapshot
            .entries
            .into_iter()
            .map(|entry| CredentialStatusItem {
                id: entry.id,
                priority: entry.priority,
                disabled: entry.disabled,
                failure_count: entry.failure_count,
                is_current: entry.id == snapshot.current_id,
                expires_at: entry.expires_at,
                auth_method: entry.auth_method,
                has_kiro_api_key: entry.has_kiro_api_key,
                has_profile_arn: entry.has_profile_arn,
                refresh_token_hash: entry.refresh_token_hash,
                email: entry.email,
                nickname: entry.nickname,
                success_count: entry.success_count,
                last_used_at: entry.last_used_at.clone(),
                has_proxy: entry.has_proxy,
                proxy_url: entry.proxy_url,
                api_region: entry.api_region,
                runtime_endpoint: entry.runtime_endpoint,
            })
            .collect();

        // 按优先级排序（数字越小优先级越高）
        credentials.sort_by_key(|c| c.priority);

        CredentialsStatusResponse {
            total: snapshot.total,
            available: snapshot.available,
            current_id: snapshot.current_id,
            credentials,
        }
    }

    /// 导出完整凭据列表（包含敏感 token，仅限 Admin API 使用）
    pub fn export_credentials(&self) -> Vec<KiroCredentials> {
        self.token_manager.export_credentials()
    }

    /// 设置凭据禁用状态
    pub fn set_disabled(&self, id: u64, disabled: bool) -> Result<(), AdminServiceError> {
        // 先获取当前凭据 ID，用于判断是否需要切换
        let snapshot = self.token_manager.snapshot();
        let current_id = snapshot.current_id;

        self.token_manager
            .set_disabled(id, disabled)
            .map_err(|e| self.classify_error(e, id))?;

        // 只有禁用的是当前凭据时才尝试切换到下一个
        if disabled && id == current_id {
            let _ = self.token_manager.switch_to_next();
        }
        if disabled {
            let snapshot = self.token_manager.snapshot();
            if snapshot.available == 0 {
                crate::alert::notify_all_credentials_unavailable(format!(
                    "管理员手动禁用凭据 #{} 后，当前没有可用账号",
                    id
                ));
            }
        }
        Ok(())
    }

    /// 设置凭据优先级
    pub fn set_priority(&self, id: u64, priority: u32) -> Result<(), AdminServiceError> {
        self.token_manager
            .set_priority(id, priority)
            .map_err(|e| self.classify_error(e, id))
    }

    /// 重置失败计数并重新启用
    pub fn reset_and_enable(&self, id: u64) -> Result<(), AdminServiceError> {
        self.token_manager
            .reset_and_enable(id)
            .map_err(|e| self.classify_error(e, id))
    }

    /// 获取凭据余额（带缓存）
    pub async fn get_balance(&self, id: u64) -> Result<BalanceResponse, AdminServiceError> {
        // 先查缓存
        {
            let cache = self.balance_cache.lock();
            if let Some(cached) = cache.get(&id) {
                let now = Utc::now().timestamp() as f64;
                if (now - cached.cached_at) < BALANCE_CACHE_TTL_SECS as f64 {
                    tracing::debug!("凭据 #{} 余额命中缓存", id);
                    return Ok(cached.data.clone());
                }
            }
        }

        // 缓存未命中或已过期，从上游获取
        let balance = self.fetch_balance(id).await?;

        // 更新缓存
        {
            let mut cache = self.balance_cache.lock();
            cache.insert(
                id,
                CachedBalance {
                    cached_at: Utc::now().timestamp() as f64,
                    data: balance.clone(),
                },
            );
        }
        self.save_balance_cache();

        Ok(balance)
    }

    /// 从上游获取余额（无缓存）
    async fn fetch_balance(&self, id: u64) -> Result<BalanceResponse, AdminServiceError> {
        let usage = self
            .token_manager
            .get_usage_limits_for(id)
            .await
            .map_err(|e| self.classify_balance_error(e, id))?;

        let current_usage = usage.current_usage();
        let usage_limit = usage.usage_limit();
        let remaining = (usage_limit - current_usage).max(0.0);
        let usage_percentage = if usage_limit > 0.0 {
            (current_usage / usage_limit * 100.0).min(100.0)
        } else {
            0.0
        };

        Ok(BalanceResponse {
            id,
            subscription_title: usage.subscription_title().map(|s| s.to_string()),
            current_usage,
            usage_limit,
            remaining,
            usage_percentage,
            next_reset_at: usage.next_date_reset,
        })
    }

    /// 添加新凭据
    pub async fn probe_credential(&self, id: u64) -> ProbeCredentialResult {
        let disabled = self
            .token_manager
            .snapshot()
            .entries
            .into_iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.disabled)
            .unwrap_or(false);
        let started = Instant::now();

        match self.fetch_balance(id).await {
            Ok(balance) => ProbeCredentialResult {
                id,
                success: true,
                disabled,
                duration_ms: started.elapsed().as_millis(),
                message: "探测成功".to_string(),
                subscription_title: balance.subscription_title,
                remaining: Some(balance.remaining),
                usage_limit: Some(balance.usage_limit),
                error: None,
            },
            Err(e) => ProbeCredentialResult {
                id,
                success: false,
                disabled,
                duration_ms: started.elapsed().as_millis(),
                message: "探测失败".to_string(),
                subscription_title: None,
                remaining: None,
                usage_limit: None,
                error: Some(e.to_string()),
            },
        }
    }

    pub async fn refresh_token(&self, id: u64) -> Result<(), AdminServiceError> {
        self.token_manager
            .refresh_token_for(id)
            .await
            .map_err(|e| self.classify_error(e, id))
    }

    pub async fn probe_credentials(
        &self,
        req: ProbeCredentialsRequest,
    ) -> ProbeCredentialsResponse {
        let interval_ms = req.interval_ms.clamp(500, 60_000);
        let ids: Vec<u64> = self
            .token_manager
            .snapshot()
            .entries
            .into_iter()
            .filter(|entry| req.include_disabled || !entry.disabled)
            .map(|entry| entry.id)
            .collect();

        let mut results = Vec::with_capacity(ids.len());
        for (index, id) in ids.iter().copied().enumerate() {
            results.push(self.probe_credential(id).await);
            if index + 1 < ids.len() {
                tokio::time::sleep(Duration::from_millis(interval_ms)).await;
            }
        }

        let success = results.iter().filter(|result| result.success).count();
        let failed = results.len().saturating_sub(success);
        ProbeCredentialsResponse {
            total: results.len(),
            success,
            failed,
            interval_ms,
            results,
        }
    }

    pub async fn add_credential(
        &self,
        req: AddCredentialRequest,
    ) -> Result<AddCredentialResponse, AdminServiceError> {
        // 构建凭据对象
        let new_cred = KiroCredentials {
            id: None,
            access_token: None,
            refresh_token: req.refresh_token,
            kiro_api_key: req.kiro_api_key,
            profile_arn: None,
            expires_at: None,
            auth_method: Some(req.auth_method),
            client_id: req.client_id,
            client_secret: req.client_secret,
            priority: req.priority,
            region: req.region,
            auth_region: req.auth_region,
            api_region: req.api_region,
            runtime_endpoint: req.runtime_endpoint,
            management_endpoint: req.management_endpoint,
            machine_id: req.machine_id,
            email: req.email,
            nickname: req.nickname,
            subscription_title: None, // 将在首次获取使用额度时自动更新
            proxy_url: req.proxy_url,
            proxy_username: req.proxy_username,
            proxy_password: req.proxy_password,
            disabled: false, // 新添加的凭据默认启用
        };

        // 调用 token_manager 添加凭据
        let credential_id = self
            .token_manager
            .add_credential(new_cred)
            .await
            .map_err(|e| self.classify_add_error(e))?;

        // 读取刷新后实际存储的 email（可能由 JWT 自动提取）
        let actual_email = self
            .token_manager
            .snapshot()
            .entries
            .into_iter()
            .find(|e| e.id == credential_id)
            .and_then(|e| e.email);

        // 后台获取订阅等级，避免首次请求时 Free 账号绕过 Opus 模型过滤
        let tm = self.token_manager.clone();
        tokio::spawn(async move {
            if let Err(e) = tm.get_usage_limits_for(credential_id).await {
                tracing::warn!("添加凭据后获取订阅等级失败（不影响凭据添加）: {}", e);
            }
        });

        Ok(AddCredentialResponse {
            success: true,
            message: format!("凭据添加成功，ID: {}", credential_id),
            credential_id,
            email: actual_email,
        })
    }

    /// 删除凭据
    pub fn delete_credential(&self, id: u64) -> Result<(), AdminServiceError> {
        self.token_manager
            .delete_credential(id)
            .map_err(|e| self.classify_delete_error(e, id))?;

        // 清理已删除凭据的余额缓存
        {
            let mut cache = self.balance_cache.lock();
            cache.remove(&id);
        }
        self.save_balance_cache();

        Ok(())
    }

    /// 更新凭据配置
    pub async fn update_credential(
        &self,
        id: u64,
        req: UpdateCredentialRequest,
    ) -> Result<(), AdminServiceError> {
        self.token_manager
            .update_credential(id, req)
            .await
            .map_err(|e| self.classify_update_error(e, id))?;

        // 清理该凭据的余额缓存（配置变更后需要重新获取）
        {
            let mut cache = self.balance_cache.lock();
            cache.remove(&id);
        }
        self.save_balance_cache();

        Ok(())
    }

    /// 获取负载均衡模式
    pub fn get_load_balancing_mode(&self) -> LoadBalancingModeResponse {
        LoadBalancingModeResponse {
            mode: self.token_manager.get_load_balancing_mode(),
        }
    }

    /// 设置负载均衡模式
    pub fn set_load_balancing_mode(
        &self,
        req: SetLoadBalancingModeRequest,
    ) -> Result<LoadBalancingModeResponse, AdminServiceError> {
        // 验证模式值
        if req.mode != "priority" && req.mode != "balanced" {
            return Err(AdminServiceError::InvalidCredential(
                "mode 必须是 'priority' 或 'balanced'".to_string(),
            ));
        }

        self.token_manager
            .set_load_balancing_mode(req.mode.clone())
            .map_err(|e| AdminServiceError::InternalError(e.to_string()))?;

        Ok(LoadBalancingModeResponse { mode: req.mode })
    }

    pub fn get_kv_cache_config(&self) -> KvCacheConfigResponse {
        KvCacheConfigResponse {
            cache_read_efficiency: crate::anthropic::kv_cache::get_cache_read_efficiency(),
            kv_cache_ttl_secs: crate::anthropic::kv_cache::get_kv_cache_ttl_secs(),
            record_request_payloads: crate::anthropic::kv_cache::get_record_request_payloads(),
        }
    }

    pub fn set_kv_cache_config(
        &self,
        req: SetKvCacheConfigRequest,
    ) -> Result<KvCacheConfigResponse, AdminServiceError> {
        let config_path = self
            .token_manager
            .config()
            .config_path()
            .ok_or_else(|| AdminServiceError::InternalError("配置文件路径未知".to_string()))?;

        let mut config = crate::model::config::Config::load(config_path)
            .map_err(|e| AdminServiceError::InternalError(format!("加载配置失败: {}", e)))?;

        if let Some(efficiency) = req.cache_read_efficiency {
            config.cache_read_efficiency = efficiency.clamp(0.0, 1.0);
        }
        if let Some(ttl) = req.kv_cache_ttl_secs {
            config.kv_cache_ttl_secs = ttl.max(60);
        }
        if let Some(enabled) = req.record_request_payloads {
            config.record_request_payloads = enabled;
        }

        config
            .save()
            .map_err(|e| AdminServiceError::InternalError(format!("保存配置失败: {}", e)))?;
        crate::anthropic::kv_cache::set_kv_cache_config(
            config.cache_read_efficiency,
            config.kv_cache_ttl_secs,
            config.record_request_payloads,
        );

        Ok(KvCacheConfigResponse {
            cache_read_efficiency: config.cache_read_efficiency,
            kv_cache_ttl_secs: config.kv_cache_ttl_secs,
            record_request_payloads: config.record_request_payloads,
        })
    }

    // ============ 余额缓存持久化 ============

    pub fn get_alert_config(&self) -> AlertConfigResponse {
        let (wecom_webhook_url, cooldown_secs) = crate::alert::get_wecom_webhook_config();
        AlertConfigResponse {
            wecom_webhook_url,
            all_credentials_unavailable_alert_cooldown_secs: cooldown_secs,
        }
    }

    pub fn set_alert_config(
        &self,
        req: SetAlertConfigRequest,
    ) -> Result<AlertConfigResponse, AdminServiceError> {
        let config_path = self
            .token_manager
            .config()
            .config_path()
            .ok_or_else(|| AdminServiceError::InternalError("配置文件路径未知".to_string()))?;

        let mut config = crate::model::config::Config::load(config_path)
            .map_err(|e| AdminServiceError::InternalError(format!("加载配置失败: {}", e)))?;

        if let Some(webhook) = req.wecom_webhook_url {
            config.wecom_webhook_url = webhook.and_then(|v| {
                let trimmed = v.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            });
        }
        if let Some(cooldown) = req.all_credentials_unavailable_alert_cooldown_secs {
            config.all_credentials_unavailable_alert_cooldown_secs = cooldown.max(60);
        }

        config
            .validate()
            .map_err(|e| AdminServiceError::InvalidCredential(e.to_string()))?;
        config
            .save()
            .map_err(|e| AdminServiceError::InternalError(format!("保存配置失败: {}", e)))?;

        crate::alert::set_wecom_webhook_config(
            config.wecom_webhook_url.clone(),
            config.all_credentials_unavailable_alert_cooldown_secs,
        );

        Ok(AlertConfigResponse {
            wecom_webhook_url: config.wecom_webhook_url,
            all_credentials_unavailable_alert_cooldown_secs: config
                .all_credentials_unavailable_alert_cooldown_secs,
        })
    }

    pub fn get_request_details(
        &self,
        limit: Option<usize>,
    ) -> Result<RequestDetailsResponse, AdminServiceError> {
        let limit = limit
            .unwrap_or(REQUEST_DETAILS_DEFAULT_LIMIT)
            .clamp(1, REQUEST_DETAILS_MAX_LIMIT);

        let file = match File::open(&self.request_details_path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RequestDetailsResponse {
                    total: 0,
                    records: Vec::new(),
                });
            }
            Err(e) => {
                return Err(AdminServiceError::InternalError(format!(
                    "读取请求明细文件失败: {}",
                    e
                )));
            }
        };

        let reader = BufReader::new(file);
        let mut rows = Vec::new();

        for (line_no, line) in reader.lines().enumerate() {
            let line = match line {
                Ok(line) => line,
                Err(e) => {
                    tracing::warn!("读取请求明细第 {} 行失败: {}", line_no + 1, e);
                    continue;
                }
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let mut parsed = false;
            let mut had_error = false;
            for item in serde_json::Deserializer::from_str(line).into_iter::<KvCacheRecordRow>() {
                match item {
                    Ok(row) => {
                        rows.push(row);
                        parsed = true;
                    }
                    Err(e) => {
                        tracing::warn!("解析请求明细第 {} 行失败: {}", line_no + 1, e);
                        had_error = true;
                        break;
                    }
                }
            }
            if !parsed && !had_error {
                tracing::warn!("解析请求明细第 {} 行失败: 空或无效 JSON", line_no + 1);
            }
        }

        let total = rows.len();
        let records = rows
            .into_iter()
            .rev()
            .take(limit)
            .map(Self::map_request_detail)
            .collect();

        Ok(RequestDetailsResponse { total, records })
    }

    pub fn clear_request_details(&self) -> Result<(), AdminServiceError> {
        File::create(&self.request_details_path)
            .map(|_| ())
            .map_err(|e| AdminServiceError::InternalError(format!("清空请求明细文件失败: {}", e)))
    }

    fn map_request_detail(row: KvCacheRecordRow) -> RequestDetailItem {
        let total_input_tokens = row.input_tokens.max(0);
        let cache_creation_tokens = row.cache_creation_input_tokens.max(0);
        let cached_tokens = row.cache_read_input_tokens.max(0);
        let input_tokens = total_input_tokens
            .saturating_sub(cache_creation_tokens.saturating_add(cached_tokens))
            .max(0);
        let output_tokens = row.output_tokens.max(0);
        let cache_ratio = if total_input_tokens > 0 {
            (cached_tokens as f64 / total_input_tokens as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let cost_usd = Self::calculate_request_cost(
            &row.model,
            input_tokens,
            output_tokens,
            cache_creation_tokens,
            cached_tokens,
        );

        RequestDetailItem {
            recorded_at: row.recorded_at,
            request_id: row.request_id,
            endpoint: row.endpoint,
            model: row.model,
            credential_id: row.credential_id,
            stream: row.stream,
            cache_hit: row.cache_hit,
            input_tokens,
            cached_tokens,
            output_tokens,
            cache_ratio,
            cost_usd,
            credits_used: if row.credits_used.is_finite() {
                row.credits_used.max(0.0)
            } else {
                0.0
            },
            special_settings: row.special_settings,
            status: row.status,
            latency_ms: row.latency_ms,
            client_ip: row.client_ip,
            request_body: row.request_body,
            response_body: row.response_body,
        }
    }

    fn calculate_request_cost(
        model: &str,
        input_tokens: i32,
        output_tokens: i32,
        cache_creation_tokens: i32,
        cache_read_tokens: i32,
    ) -> f64 {
        let pricing = Self::model_pricing(model);
        let input = input_tokens.max(0) as f64;
        let output = output_tokens.max(0) as f64;
        let cache_creation = cache_creation_tokens.max(0) as f64;
        let cache_read = cache_read_tokens.max(0) as f64;
        let usd = (input * pricing.input_per_million
            + cache_creation * pricing.cache_write_per_million
            + cache_read * pricing.cache_read_per_million
            + output * pricing.output_per_million)
            / 1_000_000.0;

        if usd.is_finite() { usd.max(0.0) } else { 0.0 }
    }

    fn model_pricing(model: &str) -> ModelPricing {
        let model = model.to_lowercase();
        if model.contains("opus") {
            ModelPricing {
                input_per_million: 15.0,
                output_per_million: 75.0,
                cache_write_per_million: 18.75,
                cache_read_per_million: 1.5,
            }
        } else if model.contains("haiku") {
            ModelPricing {
                input_per_million: 0.8,
                output_per_million: 4.0,
                cache_write_per_million: 1.0,
                cache_read_per_million: 0.08,
            }
        } else {
            ModelPricing {
                input_per_million: 3.0,
                output_per_million: 15.0,
                cache_write_per_million: 3.75,
                cache_read_per_million: 0.3,
            }
        }
    }

    fn load_balance_cache_from(cache_path: &Option<PathBuf>) -> HashMap<u64, CachedBalance> {
        let path = match cache_path {
            Some(p) => p,
            None => return HashMap::new(),
        };

        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return HashMap::new(),
        };

        // 文件中使用字符串 key 以兼容 JSON 格式
        let map: HashMap<String, CachedBalance> = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("解析余额缓存失败，将忽略: {}", e);
                return HashMap::new();
            }
        };

        let now = Utc::now().timestamp() as f64;
        map.into_iter()
            .filter_map(|(k, v)| {
                let id = k.parse::<u64>().ok()?;
                // 丢弃超过 TTL 的条目
                if (now - v.cached_at) < BALANCE_CACHE_TTL_SECS as f64 {
                    Some((id, v))
                } else {
                    None
                }
            })
            .collect()
    }

    fn save_balance_cache(&self) {
        let path = match &self.cache_path {
            Some(p) => p,
            None => return,
        };

        // 持有锁期间完成序列化和写入，防止并发损坏
        let cache = self.balance_cache.lock();
        let map: HashMap<String, &CachedBalance> =
            cache.iter().map(|(k, v)| (k.to_string(), v)).collect();

        match serde_json::to_string_pretty(&map) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    tracing::warn!("保存余额缓存失败: {}", e);
                }
            }
            Err(e) => tracing::warn!("序列化余额缓存失败: {}", e),
        }
    }

    // ============ 错误分类 ============

    /// 分类简单操作错误（set_disabled, set_priority, reset_and_enable）
    fn classify_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();
        if msg.contains("不存在") {
            AdminServiceError::NotFound { id }
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类余额查询错误（可能涉及上游 API 调用）
    fn classify_balance_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();

        // 1. 凭据不存在
        if msg.contains("不存在") {
            return AdminServiceError::NotFound { id };
        }

        // 2. 上游服务错误特征：HTTP 响应错误或网络错误
        let is_upstream_error =
            // HTTP 响应错误（来自 refresh_*_token 的错误消息）
            msg.contains("凭证已过期或无效") ||
            msg.contains("权限不足") ||
            msg.contains("已被限流") ||
            msg.contains("服务器错误") ||
            msg.contains("Token 刷新失败") ||
            msg.contains("暂时不可用") ||
            // 网络错误（reqwest 错误）
            msg.contains("error trying to connect") ||
            msg.contains("connection") ||
            msg.contains("timeout") ||
            msg.contains("timed out");

        if is_upstream_error {
            AdminServiceError::UpstreamError(msg)
        } else {
            // 3. 默认归类为内部错误（本地验证失败、配置错误等）
            // 包括：缺少 refreshToken、refreshToken 已被截断、无法生成 machineId 等
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类添加凭据错误
    fn classify_add_error(&self, e: anyhow::Error) -> AdminServiceError {
        let msg = e.to_string();

        // 凭据验证失败（refreshToken 无效、格式错误等）
        let is_invalid_credential = msg.contains("缺少 refreshToken")
            || msg.contains("refreshToken 为空")
            || msg.contains("refreshToken 已被截断")
            || msg.contains("凭据已存在")
            || msg.contains("refreshToken 重复")
            || msg.contains("凭证已过期或无效")
            || msg.contains("权限不足")
            || msg.contains("已被限流");

        if is_invalid_credential {
            AdminServiceError::InvalidCredential(msg)
        } else if msg.contains("error trying to connect")
            || msg.contains("connection")
            || msg.contains("timeout")
        {
            AdminServiceError::UpstreamError(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类删除凭据错误
    fn classify_delete_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();
        if msg.contains("不存在") {
            AdminServiceError::NotFound { id }
        } else if msg.contains("只能删除已禁用的凭据") || msg.contains("请先禁用凭据")
        {
            AdminServiceError::InvalidCredential(msg)
        } else {
            AdminServiceError::InternalError(msg)
        }
    }

    /// 分类更新凭据错误
    fn classify_update_error(&self, e: anyhow::Error, id: u64) -> AdminServiceError {
        let msg = e.to_string();
        if msg.contains("不存在") {
            AdminServiceError::NotFound { id }
        } else if msg.contains("凭证已过期或无效")
            || msg.contains("权限不足")
            || msg.contains("已被限流")
            || msg.contains("error trying to connect")
            || msg.contains("timeout")
        {
            AdminServiceError::UpstreamError(msg)
        } else {
            AdminServiceError::InvalidCredential(msg)
        }
    }
}
