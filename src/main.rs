mod admin;
mod admin_ui;
mod anthropic;
mod cache;
mod common;
mod health;
mod http_client;
mod kiro;
mod model;
pub mod token;

use std::net::SocketAddr;
use std::sync::Arc;

use clap::Parser;
use kiro::model::credentials::{CredentialsConfig, KiroCredentials};
use kiro::provider::KiroProvider;
use kiro::token_manager::MultiTokenManager;
use model::api_key::ApiKeyManager;
use model::arg::Args;
use model::config::Config;
use model::usage::UsageTracker;

#[tokio::main]
async fn main() {
    // 解析命令行参数
    let args = Args::parse();

    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // 加载配置
    let config_path = args
        .config
        .unwrap_or_else(|| Config::default_config_path().to_string());
    let config = Config::load(&config_path).unwrap_or_else(|e| {
        tracing::error!("加载配置失败: {}", e);
        std::process::exit(1);
    });
    if let Err(e) = config.validate() {
        tracing::error!("配置校验失败: {}", e);
        std::process::exit(1);
    }

    // 加载凭证（支持单对象或数组格式）
    let credentials_path = args
        .credentials
        .unwrap_or_else(|| KiroCredentials::default_credentials_path().to_string());
    let credentials_config = CredentialsConfig::load(&credentials_path).unwrap_or_else(|e| {
        tracing::error!("加载凭证失败: {}", e);
        std::process::exit(1);
    });

    // 判断是否为多凭据格式（用于刷新后回写）
    let is_multiple_format = credentials_config.is_multiple();

    // 转换为按优先级排序的凭据列表
    let mut credentials_list = credentials_config.into_sorted_credentials();
    if credentials_list.is_empty() && config.effective_kiro_api_key().is_some() {
        tracing::info!("未加载 credentials.json，使用全局 Kiro API Key 创建无状态凭据");
        credentials_list.push(KiroCredentials {
            id: Some(1),
            kiro_api_key: None,
            api_region: config.api_region.clone(),
            ..Default::default()
        });
    }
    if credentials_list.is_empty() {
        tracing::error!(
            "未配置任何上游凭据。请提供 credentials.json，或在 config.json / KIRO_API_KEY 中配置上游 Kiro API Key"
        );
        std::process::exit(1);
    }
    tracing::info!("已加载 {} 个凭据配置", credentials_list.len());

    // 获取第一个凭据用于日志显示
    let first_credentials = credentials_list.first().cloned().unwrap_or_default();
    tracing::debug!("主凭证: {:?}", first_credentials);

    // 获取 API Key
    let api_key = config.api_key.clone().unwrap_or_else(|| {
        tracing::error!("配置文件中未设置 apiKey");
        std::process::exit(1);
    });
    let api_key_shared = Arc::new(parking_lot::RwLock::new(api_key.clone()));

    // 构建代理配置
    let proxy_config = config
        .proxy_url
        .as_ref()
        .map(|url| {
            let mut proxy = http_client::ProxyConfig::new(url);
            if let (Some(username), Some(password)) =
                (&config.proxy_username, &config.proxy_password)
            {
                proxy = proxy.with_auth(username, password);
            }
            proxy
        })
        .or_else(|| {
            if config.use_system_proxy {
                Some(http_client::ProxyConfig::new("system"))
            } else {
                None
            }
        });

    if let Some(proxy) = &proxy_config {
        if proxy.url.eq_ignore_ascii_case("system") {
            tracing::info!("已启用系统代理配置");
        } else {
            tracing::info!("已配置 HTTP 代理: {}", proxy.url);
        }
    }

    // 创建 MultiTokenManager 和 KiroProvider
    let token_manager = MultiTokenManager::new(
        config.clone(),
        credentials_list,
        proxy_config.clone(),
        Some(credentials_path.into()),
        is_multiple_format,
    )
    .unwrap_or_else(|e| {
        tracing::error!("创建 Token 管理器失败: {}", e);
        std::process::exit(1);
    });
    let token_manager = Arc::new(token_manager);

    // 创建 RPM 追踪器
    let rpm_tracker = Arc::new(model::rpm::RpmTracker::new());

    let kiro_provider = KiroProvider::with_proxy(token_manager.clone(), proxy_config.clone())
        .with_rpm_tracker(rpm_tracker.clone());

    // 初始化 count_tokens 配置
    token::init_config(token::CountTokensConfig {
        api_url: config.count_tokens_api_url.clone(),
        api_key: config.count_tokens_api_key.clone(),
        auth_type: config.count_tokens_auth_type.clone(),
        proxy: proxy_config,
        tls_backend: config.tls_backend,
    });
    anthropic::kv_cache::set_kv_cache_config(
        config.cache_read_efficiency,
        config.kv_cache_ttl_secs,
    );

    // 初始化 API Key 管理器和用量追踪器（Admin 启用时才加载）
    let admin_key_valid = config
        .admin_api_key
        .as_ref()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);

    let (api_key_manager, usage_tracker) = if admin_key_valid {
        let data_dir = std::path::Path::new(&config_path)
            .parent()
            .unwrap_or(std::path::Path::new("."));

        let manager = ApiKeyManager::load(data_dir.join("api_keys.json")).unwrap_or_else(|e| {
            tracing::error!("加载 API Key 数据失败: {}", e);
            std::process::exit(1);
        });
        let manager = Arc::new(manager);

        let tracker = UsageTracker::load(data_dir.join("api_key_usage.json")).unwrap_or_else(|e| {
            tracing::error!("加载用量数据失败: {}", e);
            std::process::exit(1);
        });
        let tracker = Arc::new(tracker);

        tracing::info!("API Key 多用户管理已启用");
        (Some(manager), Some(tracker))
    } else {
        (None, None)
    };

    let mut anthropic_app_state = anthropic::middleware::AppState::new(api_key_shared.clone())
        .with_rpm_tracker(rpm_tracker.clone());
    if let Some(ref manager) = api_key_manager {
        anthropic_app_state = anthropic_app_state.with_api_key_manager(manager.clone());
    }
    if let Some(ref tracker) = usage_tracker {
        anthropic_app_state = anthropic_app_state.with_usage_tracker(tracker.clone());
    }

    let anthropic_app = anthropic::create_router_with_provider_and_state(
        anthropic_app_state,
        Some(kiro_provider),
        first_credentials.profile_arn.clone(),
    );

    // 构建 Admin API 路由（如果配置了非空的 admin_api_key）
    let app = if let Some(admin_key) = &config.admin_api_key {
        if admin_key.trim().is_empty() {
            tracing::warn!("admin_api_key 配置为空，Admin API 未启用");
            anthropic_app
        } else {
            let admin_service = admin::AdminService::new(token_manager.clone());
            let admin_api_key_shared = Arc::new(parking_lot::RwLock::new(admin_key.clone()));
            let mut admin_state = admin::AdminState::new(admin_api_key_shared, admin_service)
                .with_master_api_key(api_key_shared.clone())
                .with_rpm_tracker(rpm_tracker.clone())
                .with_config_path(std::path::PathBuf::from(&config_path));
            if let Some(ref manager) = api_key_manager {
                admin_state = admin_state.with_api_key_manager(manager.clone());
            }
            if let Some(ref tracker) = usage_tracker {
                admin_state = admin_state.with_usage_tracker(tracker.clone());
            }
            let admin_app = admin::create_admin_router(admin_state);
            let admin_ui_app = admin_ui::create_admin_ui_router();

            tracing::info!("Admin API 已启用");
            tracing::info!("Admin UI 已启用: /admin");
            anthropic_app
                .nest("/api/admin", admin_app)
                .nest("/admin", admin_ui_app)
        }
    } else {
        anthropic_app
    };

    let health_app = health::create_router(health::HealthState {
        config: config.clone(),
        token_manager: token_manager.clone(),
        admin_enabled: admin_key_valid,
    });
    let app = app.merge(health_app);

    // 启动服务器
    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("启动 Anthropic API 端点: {}", addr);
    tracing::info!("API Key: {}***", &api_key[..(api_key.len() / 2)]);
    tracing::info!("可用 API:");
    tracing::info!("  GET  /v1/models");
    tracing::info!("  POST /v1/messages");
    tracing::info!("  POST /v1/messages/count_tokens");
    if admin_key_valid {
        tracing::info!("Admin API:");
        tracing::info!("  GET  /api/admin/credentials");
        tracing::info!("  POST /api/admin/credentials/:index/disabled");
        tracing::info!("  POST /api/admin/credentials/:index/priority");
        tracing::info!("  POST /api/admin/credentials/:index/reset");
        tracing::info!("  GET  /api/admin/credentials/:index/balance");
        tracing::info!("Admin UI:");
        tracing::info!("  GET  /admin");
    }

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .unwrap();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("收到退出信号，正在优雅关闭服务");
}
