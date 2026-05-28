use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TlsBackend {
    Rustls,
    NativeTls,
}

impl Default for TlsBackend {
    fn default() -> Self {
        Self::Rustls
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum KiroEndpointFamily {
    LegacyAws,
    KiroDev,
}

impl Default for KiroEndpointFamily {
    fn default() -> Self {
        Self::LegacyAws
    }
}

/// KNA 应用配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_host")]
    pub host: String,

    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default = "default_region")]
    pub region: String,

    /// Auth Region（用于 Token 刷新），未配置时回退到 region
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_region: Option<String>,

    /// API Region（用于 API 请求），未配置时回退到 region
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_region: Option<String>,

    #[serde(default = "default_kiro_version")]
    pub kiro_version: String,

    #[serde(default)]
    pub machine_id: Option<String>,

    #[serde(default)]
    pub api_key: Option<String>,

    /// 上游 Kiro API Key（ksk_ 开头），可用 KIRO_API_KEY 环境变量覆盖
    #[serde(default, alias = "kiro_api_key")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kiro_api_key: Option<String>,

    #[serde(default = "default_system_version")]
    pub system_version: String,

    #[serde(default = "default_node_version")]
    pub node_version: String,

    #[serde(default = "default_tls_backend")]
    pub tls_backend: TlsBackend,

    /// 未显式配置 proxyUrl 时是否使用系统代理环境变量
    #[serde(default = "default_use_system_proxy")]
    pub use_system_proxy: bool,

    /// 上游 endpoint 家族：legacy-aws 使用 q.<region>.amazonaws.com；kiro-dev 使用 runtime/management.<region>.kiro.dev
    #[serde(default = "default_endpoint_family")]
    pub endpoint_family: KiroEndpointFamily,

    /// 覆盖 runtime endpoint，例如 https://runtime.us-east-1.kiro.dev
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_endpoint: Option<String>,

    /// 覆盖 management endpoint，例如 https://management.us-east-1.kiro.dev
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub management_endpoint: Option<String>,

    /// 外部 count_tokens API 地址（可选）
    #[serde(default)]
    pub count_tokens_api_url: Option<String>,

    /// count_tokens API 密钥（可选）
    #[serde(default)]
    pub count_tokens_api_key: Option<String>,

    /// count_tokens API 认证类型（可选，"x-api-key" 或 "bearer"，默认 "x-api-key"）
    #[serde(default = "default_count_tokens_auth_type")]
    pub count_tokens_auth_type: String,

    /// HTTP 代理地址（可选）
    /// 支持格式: http://host:port, https://host:port, socks5://host:port
    #[serde(default)]
    pub proxy_url: Option<String>,

    /// 代理认证用户名（可选）
    #[serde(default)]
    pub proxy_username: Option<String>,

    /// 代理认证密码（可选）
    #[serde(default)]
    pub proxy_password: Option<String>,

    /// Admin API 密钥（可选，设置后启用 Admin API 和 Admin UI）
    #[serde(default)]
    pub admin_api_key: Option<String>,

    /// 负载均衡模式（"priority" 或 "balanced"）
    #[serde(default = "default_load_balancing_mode")]
    pub load_balancing_mode: String,

    /// 同时发往 Kiro 上游的最大请求数
    #[serde(default = "default_max_concurrent_requests")]
    pub max_concurrent_requests: usize,

    /// 每个凭据在一次请求中的最大尝试次数
    #[serde(default = "default_max_retries_per_credential")]
    pub max_retries_per_credential: usize,

    /// 单次请求跨凭据的总尝试上限
    #[serde(default = "default_max_total_retries")]
    pub max_total_retries: usize,

    /// 配置文件路径（运行时元数据，不写入 JSON）
    #[serde(skip)]
    config_path: Option<PathBuf>,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_region() -> String {
    "us-east-1".to_string()
}

fn default_kiro_version() -> String {
    "0.10.0".to_string()
}

fn default_system_version() -> String {
    const SYSTEM_VERSIONS: &[&str] = &["darwin#24.6.0", "win32#10.0.22631"];
    SYSTEM_VERSIONS[fastrand::usize(..SYSTEM_VERSIONS.len())].to_string()
}

fn default_node_version() -> String {
    "22.21.1".to_string()
}

fn default_count_tokens_auth_type() -> String {
    "x-api-key".to_string()
}

fn default_tls_backend() -> TlsBackend {
    TlsBackend::Rustls
}

fn default_use_system_proxy() -> bool {
    true
}

fn default_endpoint_family() -> KiroEndpointFamily {
    KiroEndpointFamily::LegacyAws
}

fn default_load_balancing_mode() -> String {
    "priority".to_string()
}

fn default_max_concurrent_requests() -> usize {
    50
}

fn default_max_retries_per_credential() -> usize {
    3
}

fn default_max_total_retries() -> usize {
    9
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            region: default_region(),
            auth_region: None,
            api_region: None,
            kiro_version: default_kiro_version(),
            machine_id: None,
            api_key: None,
            kiro_api_key: None,
            system_version: default_system_version(),
            node_version: default_node_version(),
            tls_backend: default_tls_backend(),
            use_system_proxy: default_use_system_proxy(),
            endpoint_family: default_endpoint_family(),
            runtime_endpoint: None,
            management_endpoint: None,
            count_tokens_api_url: None,
            count_tokens_api_key: None,
            count_tokens_auth_type: default_count_tokens_auth_type(),
            proxy_url: None,
            proxy_username: None,
            proxy_password: None,
            admin_api_key: None,
            load_balancing_mode: default_load_balancing_mode(),
            max_concurrent_requests: default_max_concurrent_requests(),
            max_retries_per_credential: default_max_retries_per_credential(),
            max_total_retries: default_max_total_retries(),
            config_path: None,
        }
    }
}

impl Config {
    /// 获取默认配置文件路径
    pub fn default_config_path() -> &'static str {
        "config.json"
    }

    /// 获取有效的 Auth Region（用于 Token 刷新）
    /// 优先使用 auth_region，未配置时回退到 region
    pub fn effective_auth_region(&self) -> &str {
        self.auth_region.as_deref().unwrap_or(&self.region)
    }

    /// 获取有效的 API Region（用于 API 请求）
    /// 优先使用 api_region，未配置时回退到 region
    pub fn effective_api_region(&self) -> &str {
        self.api_region.as_deref().unwrap_or(&self.region)
    }

    pub fn validate(&self) -> anyhow::Result<()> {
        if self.host.trim().is_empty() {
            anyhow::bail!("host 不能为空");
        }
        if self.port == 0 {
            anyhow::bail!("port 不能为 0");
        }
        if self
            .api_key
            .as_deref()
            .is_none_or(|key| key.trim().is_empty())
        {
            anyhow::bail!("apiKey 不能为空，用于保护本地反代入口");
        }
        validate_region("region", &self.region)?;
        if let Some(region) = &self.auth_region {
            validate_region("authRegion", region)?;
        }
        if let Some(region) = &self.api_region {
            validate_region("apiRegion", region)?;
        }
        if let Some(url) = &self.proxy_url {
            validate_proxy_url(url)?;
        }
        if let Some(endpoint) = &self.runtime_endpoint {
            validate_endpoint_url("runtimeEndpoint", endpoint)?;
        }
        if let Some(endpoint) = &self.management_endpoint {
            validate_endpoint_url("managementEndpoint", endpoint)?;
        }
        if self.load_balancing_mode != "priority" && self.load_balancing_mode != "balanced" {
            anyhow::bail!("loadBalancingMode 必须是 priority 或 balanced");
        }
        if self.max_concurrent_requests == 0 {
            anyhow::bail!("maxConcurrentRequests 必须大于 0");
        }
        if self.max_retries_per_credential == 0 {
            anyhow::bail!("maxRetriesPerCredential 必须大于 0");
        }
        if self.max_total_retries == 0 {
            anyhow::bail!("maxTotalRetries 必须大于 0");
        }
        Ok(())
    }

    pub fn effective_kiro_api_key(&self) -> Option<String> {
        std::env::var("KIRO_API_KEY")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| self.kiro_api_key.clone().filter(|v| !v.trim().is_empty()))
    }

    pub fn runtime_host(&self, region: &str) -> String {
        if let Some(endpoint) = &self.runtime_endpoint {
            return endpoint_host(endpoint).unwrap_or_else(|| endpoint.clone());
        }

        match self.endpoint_family {
            KiroEndpointFamily::LegacyAws => format!("q.{}.amazonaws.com", region),
            KiroEndpointFamily::KiroDev => format!("runtime.{}.kiro.dev", region),
        }
    }

    pub fn runtime_url(&self, region: &str, path: &str) -> String {
        if let Some(endpoint) = &self.runtime_endpoint {
            join_endpoint(endpoint, path)
        } else {
            format!("https://{}{}", self.runtime_host(region), path)
        }
    }

    pub fn management_url(&self, region: &str, path: &str) -> String {
        if let Some(endpoint) = &self.management_endpoint {
            join_endpoint(endpoint, path)
        } else {
            let host = match self.endpoint_family {
                KiroEndpointFamily::LegacyAws => format!("q.{}.amazonaws.com", region),
                KiroEndpointFamily::KiroDev => format!("management.{}.kiro.dev", region),
            };
            format!("https://{}{}", host, path)
        }
    }

    /// 从文件加载配置
    pub fn load<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        let path = path.as_ref();
        if !path.exists() {
            // 配置文件不存在，返回默认配置
            let mut config = Self::default();
            config.config_path = Some(path.to_path_buf());
            return Ok(config);
        }

        let content = fs::read_to_string(path)?;
        let mut config: Config = serde_json::from_str(&content)?;
        config.config_path = Some(path.to_path_buf());
        Ok(config)
    }

    /// 获取配置文件路径（如果有）
    pub fn config_path(&self) -> Option<&Path> {
        self.config_path.as_deref()
    }

    /// 将当前配置写回原始配置文件
    pub fn save(&self) -> anyhow::Result<()> {
        let path = self
            .config_path
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("配置文件路径未知，无法保存配置"))?;

        let content = serde_json::to_string_pretty(self).context("序列化配置失败")?;
        fs::write(path, content)
            .with_context(|| format!("写入配置文件失败: {}", path.display()))?;
        Ok(())
    }
}

fn validate_region(name: &str, region: &str) -> anyhow::Result<()> {
    if region.trim().is_empty() {
        anyhow::bail!("{} 不能为空", name);
    }
    if !region
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        anyhow::bail!("{} 格式无效: {}", name, region);
    }
    Ok(())
}

fn validate_proxy_url(url: &str) -> anyhow::Result<()> {
    if url.eq_ignore_ascii_case("direct") || url.eq_ignore_ascii_case("system") {
        return Ok(());
    }
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("socks5://"))
    {
        anyhow::bail!("proxyUrl 仅支持 http://、https://、socks5://、direct 或 system");
    }
    Ok(())
}

fn validate_endpoint_url(name: &str, endpoint: &str) -> anyhow::Result<()> {
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://")) {
        anyhow::bail!("{} 必须以 http:// 或 https:// 开头", name);
    }
    Ok(())
}

fn join_endpoint(endpoint: &str, path: &str) -> String {
    format!(
        "{}/{}",
        endpoint.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn endpoint_host(endpoint: &str) -> Option<String> {
    endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}
