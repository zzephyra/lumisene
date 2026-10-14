# ADR-029: 模型密钥用 YAML 文件配置

## Status

Accepted — 2026-10-04。用户要求不要再把模型地址和密钥写成 `.env` 里的一行 JSON。

## Decision

- 服务端地址和密钥放在未提交的 `backend/model-endpoints.yaml`。`.env` 只保留 `MODEL_ENDPOINTS_FILE` 指向该文件。
- YAML 的键是登记模型时可以选择的 `secret_ref`。业务指定仍然在管理页完成，不写进这个文件。
- `MODEL_SECRET_REFS` 只补充尚未填写地址和密钥的名称。测试仍可直接传入 JSON 字符串。
- 增加 PyYAML。标准库不能解析 YAML，现有依赖也不读取这种配置文件。

## Consequences

密钥仍只在服务端，接口不返回明文。容器需要能读到该文件；改文件后重新创建使用它的进程。供应商别名、可登记模型和参数见 [ADR-030](030-provider-catalog-yaml.md)。
