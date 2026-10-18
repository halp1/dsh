/**
 * U-7 会话全屏查看器的会话过滤：按标题 / 项目路径 / 会话 id 做大小写不敏感
 * 子串匹配。查询为空（或纯空白）返回全量。纯函数，导出供测试。
 */
/** 会话行的最小形状（StatsBySession 行的超集兼容）。 */
interface SessionRowLike {
    id: string;
    title?: string;
    cwd?: string;
}
export declare function filterSessionsForViewer<T extends SessionRowLike>(rows: readonly T[], query: string): readonly T[];
export {};
//# sourceMappingURL=session-viewer.d.ts.map