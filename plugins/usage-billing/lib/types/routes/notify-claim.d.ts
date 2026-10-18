/**
 * 路由：POST /api/billing/notify-claim
 *
 * 跨实例提醒认领（issue #44）：多实例（CLI + 桌面等）合法共存，各自轮询
 * 会重复弹通知。两级去重——进程内 Set 挡同进程的并发/重渲染（trigger 与仪表盘
 * 是两个组件实例，effect 同周期并发时本地 store 标记读到的还是旧值）；跨进程走
 * 认领端点（先到先得），另一实例刚发过则跳过。端点不可达（旧版本/网络故障）
 * 时放行，退化为原有 per-客户端去重。通知构造失败（平台限制）静默。
 *
 * 路由文件职责：handler + 模块级 `notifyClaims` 单例（与 `loadNotifications`
 * 共享内存状态——先到先得认领）。文件持久化（`writeFileAtomic`）由 index.ts 装配
 * 器通过 `claimsPath` 注入；handler 拿到路径后自行管理读写。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 路由依赖：装配器注入，无需直接读 ctx。 */
export interface NotifyClaimDeps {
    /** 反向代理白名单（来自 `config.trustedHosts` 经 normalizeTrustedHosts 归一化）。 */
    trustedHosts: ReadonlySet<string>;
    /** 认领表文件路径：`<snapshotPath>.notify-claims.json`。 */
    claimsPath: string;
}
/** 注册路由到 cordis webServer effect；handler 闭包外只读 deps。 */
export declare function registerNotifyClaimRoute(ctx: Context, deps: NotifyClaimDeps): void;
//# sourceMappingURL=notify-claim.d.ts.map