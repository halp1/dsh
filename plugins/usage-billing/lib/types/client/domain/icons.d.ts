/**
 * v1.5 Tab 内联 SVG 图标（14×14，无外部依赖；用 stroke="currentColor" 复用单 CSS 规则）。
 * 抽到独立文件让 UsageBilling.tsx 体积下降；每个图标是 React.ReactNode，可被
 * `<span aria-hidden>{icon}</span>` 包装嵌入。
 */
import type { ReactNode } from 'react';
import type { DashboardTab } from './types.ts';
export declare const TAB_ICONS: Record<DashboardTab, ReactNode>;
//# sourceMappingURL=icons.d.ts.map