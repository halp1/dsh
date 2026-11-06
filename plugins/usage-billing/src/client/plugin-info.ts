/**
 * 插件元信息（「设置 → 插件信息卡」展示）：名称 / 描述 / 作者 / 许可证。
 * 版本号不含在此——由服务端从自身 package.json 读取（pluginVersion），
 * 这样版本号与源码单一来源，不会两处不同步。
 */

/** 包名。 */
export const PLUGIN_NAME = 'dsh-plugin-usage-billing'

/** 一句话描述。 */
export const PLUGIN_DESCRIPTION = 'Usage billing dashboard for DeepSeek Harness'

/** 作者显示名。 */
export const PLUGIN_AUTHOR_NAME = 'halp'

/** 作者 GitHub 账号（作者页链接）。 */
export const PLUGIN_AUTHOR_HANDLE = 'halp1'

/** 许可证。 */
export const PLUGIN_LICENSE = 'MIT'
