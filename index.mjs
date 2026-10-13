// ESM entry: the CommonJS loader (index.cjs) does the work; native addons load through require.
import { createRequire } from 'node:module'

const kcore = createRequire(import.meta.url)('./index.cjs')

export const {
  backend,
  libraryPath,
  kcoreVersion,
  abiVersion,
  shake256,
  chainsHex,
  wotsAddress,
  wotsAddressV2,
  mlkemKeypair,
  mlkemEncaps,
  mlkemDecaps
} = kcore
export default kcore
