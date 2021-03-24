import { EthereumAddress, EthereumTxHash } from '@phala-network/typedefs/dist/phala'
import { BalanceOf } from '@polkadot/types/interfaces'
import { hexToU8a } from '@polkadot/util'
import BN from 'bn.js'
import { either } from 'fp-ts/lib/Either'
import it, { string as StrongString, Type } from 'io-ts'

export interface TokenTransaction {
    account: string
    value: string
}

const ethereumAddressRegex = /^0x[A-Fa-f0-9]{40}$/

export const ethereumAddress = new Type<string, EthereumAddress>(
    'EthereumAddress',
    StrongString.is,
    (u, c) => either.chain(
        it.string.validate(u, c),
        (s) => ethereumAddressRegex.test(s)
            ? it.success(s)
            : it.failure(s, c, 'Malformed Ethereum address')
    ),
    (a) => hexToU8a(a, 160) as EthereumAddress
)

export type StrongEthereumAddress = it.OutputOf<typeof ethereumAddress>

const ethereumTxHashRegex = /^0x([A-Fa-f0-9]{64})$/

export const ethereumTxHash = new Type<string, EthereumTxHash>(
    'EthereumTxHash',
    StrongString.is,
    (u, c) => either.chain(
        it.string.validate(u, c),
        (s) => ethereumTxHashRegex.test(s)
            ? it.success(s)
            : it.failure(s, c, 'Malformed Ethereum Tx hash')
    ),
    (a) => hexToU8a(a, 256) as EthereumTxHash
)

export type StrongEthereumTxHash = it.OutputOf<typeof ethereumTxHash>

const numberLiteralRegex = /^\d+$/

export const balanceOf = new Type<string, BalanceOf>(
    'BalanceOf',
    StrongString.is,
    (u, c) => either.chain(
        it.string.validate(u, c),
        (s) => numberLiteralRegex.test(s) ? it.success(s) : it.failure(s, c, 'Non-integer balance')
    ),
    (a) => new BN(a) as BalanceOf
)

export type StrongBalanceOf = it.OutputOf<typeof balanceOf>
