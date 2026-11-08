import { dshPluginBuild } from '../../tsdown.plugin.ts';

export default dshPluginBuild({
  id: 'dsh-plugin-multi-search',
  clientEntry: 'src/client/index.tsx',
  nodeEntry: 'src/index.ts',
});
