/**
 * 跨实例提醒认领（issue #44）：多实例（CLI + 桌面等）合法共存，各自轮询会
 * 重复弹通知。两级去重——进程内 Set 挡同进程的并发/重渲染；跨进程走宿主
 * 认领端点（先到先得），另一实例刚发过则跳过。端点不可达（旧版本/网络故障）
 * 时放行，退化为原有 per-客户端去重。通知构造失败（平台限制）静默。
 *
 * Set 导出供测试重置（模块级状态会跨用例泄漏）。
 */
export declare const notifiedKeys: Set<string>;
/** 浏览器通知可用且已授权；三处提醒发送前的同一前置判断。 */
export declare function notifyAllowed(): boolean;
/** 跨进程认领：另一实例已发则跳过；端点不可达放行。 */
export declare function notifyAcrossInstances(key: string, send: () => void): void;
//# sourceMappingURL=notify.d.ts.map