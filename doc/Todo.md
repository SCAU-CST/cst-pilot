# Todo
1. [ ] **lhmGpu iGPU 真机验证**：等一台带核显/无 N 卡的机器，跑 sys gpu 验证降级输出与 notice 语义。
2. [ ] 测试PE环境
3. [ ] **crash 回显只含第一组**：`eventlog-core.ts` 多组查询回显取 `specs[0]`，crash 五组只回显 `1000/Application Error`；改为合并所有组去重（boot 同受益）。
