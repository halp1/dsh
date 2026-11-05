/**
 * 订阅套餐 provider id → 所属模型厂商：用于把订阅额度归并到对应厂商组。
 * 厂商名与 PROVIDER_ALIASES 保持一致，使订阅卡片与模型用量落在同一组下。
 * opencode 是跨厂商订阅通道、无单一模型厂商，按自身显示名独立成组。
 */
export declare const SUBSCRIPTION_VENDORS: Readonly<Record<string, string>>;
/** 仅供测试：暴露厂商映射表（subscriptionVendorOf 仍是唯一消费入口）。 */
export declare const SUBSCRIPTION_VENDORS_FOR_TEST: Readonly<Record<string, string>>;
/** 订阅套餐归并到的厂商显示名；未知 id 回退为从 model id 反推或 id 本身。 */
export declare function subscriptionVendorOf(provider: string): string;
//# sourceMappingURL=subscription-vendors.d.ts.map