/**
 * GET/POST /api/billing/usage-tool：usage_stats 工具开关读写（插件自带，
 * 不依赖宿主浏览器设置白名单）。工具注入是启动期决策，重启应用后生效。
 */
/**
 * 读取 usage_stats 工具开关当前值（插件自带接口，不依赖宿主浏览器设置白名单）。
 * @returns 当前是否注入；读取失败（服务未起/非 JSON）返回 undefined。
 */
export declare function loadUsageTool(): Promise<boolean | undefined>;
/**
 * 写 usage_stats 工具开关（插件自带接口）。工具注入是启动期决策，重启应用后生效。
 * @param enabled - 是否注入。
 * @returns 是否写成功。
 */
export declare function saveUsageTool(enabled: boolean): Promise<boolean>;
//# sourceMappingURL=usage-tool.d.ts.map