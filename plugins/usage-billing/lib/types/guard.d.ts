/**
 * 共享 loopback 守卫（v1.5.2 抽自 src/index.ts）。
 *
 * 端点只供本机浏览器用，局域网/远端请求一律拒绝，避免面板数据（含中转站
 * origin 与余额）外泄。三层防御：peer socket（最可信）+ Host 头精确字面量
 * （防 `127.0.0.1.evil.com` 这类 DNS rebinding 域名）+ trustedHosts 白名单
 * （反向代理场景的精确主机名放行）。Origin 头独立校验（写操作用）。
 *
 * 设计要点：精确字面量匹配（`startsWith('127.')` 会被 `127.0.0.1.evil.com`
 * 穿透，必须正则）。IPv6 字面量带方括号（`[::1]:3080`）单独剥离。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Peer 地址是否为回环（本地）。回环防护：本插件的端点只供本机浏览器用，
 *  局域网/远端请求一律拒绝，避免面板数据（含中转站 origin 与余额）外泄。 */
export declare function isLoopbackPeer(req: IncomingMessage): boolean;
/** 校验 Host 头是本机回环（精确 127.0.0.0/8 / ::1 / localhost 或空，供 curl 不带 Host 的极简请求）。
 *  拒绝 `127.0.0.1.attacker.com` 这类以 `127.` 开头但解析到外部的 DNS rebinding 域名：
 *  只用 `startsWith('127.')` 会被它穿透，必须精确匹配回环 IP 的字面量。 */
/**
 * Host 头/名单条目的主机名部分：IPv6 字面量带方括号（`[::1]:3080`），整体去括号；
 * 裸 IPv6（多个冒号、无方括号）整体是字面量；其余按首个冒号去端口。统一小写。
 * （此前一律 `split(':')[0]`：`[::1]:3080` 截成 `[`，IPv6 回环请求被误拒，
 * trustedHosts 也配不进去——fail-closed 无安全暴露，但本机 IPv6 场景功能失效。）
 */
export declare function hostNameOf(host: string): string;
/**
 * 信任主机名归一化：去空白、去端口、转小写，丢弃空项（IPv6 经 {@link hostNameOf}
 * 去方括号）。与请求侧 Host 头解析同口径，因此匹配忽略大小写与端口。
 * @param hosts - 配置里的原始名单。
 * @returns 归一化后的主机名集合（空集 = 与历史版本行为一致）。
 */
export declare function normalizeTrustedHosts(hosts: readonly string[] | undefined): ReadonlySet<string>;
/** 校验 Host 头是本机回环（精确 127.0.0.0/8 / ::1 / localhost 或空，供 curl 不带 Host 的极简请求）。
 *  拒绝 `127.0.0.1.attacker.com` 这类以 `127.` 开头但解析到外部的 DNS rebinding 域名：
 *  只用 `startsWith('127.')` 会被它穿透，必须精确匹配回环 IP 的字面量。 */
export declare function isLoopbackHost(req: IncomingMessage, trustedHosts?: ReadonlySet<string>): boolean;
/** 校验 Origin 头是否回环（写操作用，防止跨站表单/fetch 改写设置）。Origin 缺失
 *  （curl 或同源 fetch 不带）视为放行，交给下方的 Content-Type 校验兜底；Origin 存在
 *  但主机非回环则拒绝——跨站脚本发起的写请求必带攻击者域名的 Origin。 */
export declare function isLoopbackOrigin(origin: string | undefined): boolean;
/**
 * 回环防护守卫：仅接受回环 GET 请求（peer socket 地址 + Host 头同时校验）。
 * 不满足时返回 403 并结束响应；调用方在 handler 顶部调用，返回 false 即已拒绝。
 * @param req - 当前请求。
 * @param res - 当前响应。
 * @returns 是否放行；false = 已拒绝并结束响应。
 */
export declare function guardLoopback(req: IncomingMessage, res: ServerResponse, trustedHosts?: ReadonlySet<string>): boolean;
//# sourceMappingURL=guard.d.ts.map