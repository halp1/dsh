/**
 * 厂商官方充值页（issue #47）：账单 Tab 余额列「充值」外链的映射表。
 * key 为归一化 provider id（前缀匹配，`minimax-cn` 命中 `minimax`）；
 * 未收录厂商不渲染按钮（宁缺毋错链）。
 *
 * 多别名厂商共享的充值页常量（表内键去重引用，控制 bundle 体积）。
 */
/**
 * 余额 provider → 官方充值页 URL。匹配顺序：归一化名精确/前缀命中 →
 * 经 PROVIDER_ALIASES 反查（余额 provider 名多为中文显示名，归一化仍是中文，
 * 需先命中 display 名再用其英文别名重试）。未收录返回 undefined。
 * 导出供测试：纯函数，不依赖组件。
 */
export declare function rechargeUrlOf(provider: string): string | undefined;
//# sourceMappingURL=recharge.d.ts.map