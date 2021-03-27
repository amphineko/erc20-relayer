import { EthereumAddress, EthereumTxHash } from '@phala-network/typedefs/dist/phala'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { AddressOrPair } from '@polkadot/api/types'
import { BalanceOf, DispatchError, Hash } from '@polkadot/types/interfaces'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { StrongBalanceOf, StrongEthereumAddress, StrongEthereumTxHash } from './data'
import { Types } from './typedefs'

export interface BurnedErc20Claim {
    address: StrongEthereumAddress
    amount: StrongBalanceOf
    tx: StrongEthereumTxHash
}

export class TransactionHashAlreadyExistError extends Error { }

export class PhalaClient {
    private readonly api: ApiPromise

    // private lastNonce: number

    public static async create(endpoint: string): Promise<PhalaClient> {
        const provider = new WsProvider(endpoint)
        const api = await ApiPromise.create({
            provider,
            types: Types
        })

        await cryptoWaitReady()

        return new PhalaClient(api)
    }

    public async queryEndHeight(): Promise<number> {
        return (await this.api.query.phaClaim.endHeight()).unwrapOrDefault().toNumber()
    }

    public async storeErc20BurnedTransaction(height: number, claims: BurnedErc20Claim[], signer: AddressOrPair): Promise<Hash> {
        // TODO: locally track nonce and pass to signAndSend

        const input: Array<[EthereumTxHash, EthereumAddress, BalanceOf]> = claims.map(claim => {
            return [claim.tx, claim.address, claim.amount]
        })

        const extrinsic = this.api.tx.phaClaim.storeErc20BurnedTransactions(height, input)
        const promise = new Promise<Hash>((resolve, reject) => {
            // TODO: pass nonce to signAndSend
            extrinsic.signAndSend(signer, (result) => {
                // TODO: use status.isInBlock while nonce is available
                if (result.status.isFinalized) {
                    const failure = result.events.filter((e) => {
                        // https://polkadot.js.org/docs/api/examples/promise/system-events
                        return this.api.events.system.ExtrinsicFailed.is(e.event)
                    })[0]

                    if (failure !== undefined) {
                        const { event: { data: [error] } } = failure
                        if ((error as DispatchError)?.isModule?.valueOf()) {
                            // https://polkadot.js.org/docs/api/cookbook/tx#how-do-i-get-the-decoded-enum-for-an-extrinsicfailed-event
                            const decoded = this.api.registry.findMetaError((error as DispatchError).asModule)
                            const { documentation, method, section } = decoded

                            if (section === 'phaClaim' && method === 'TxHashAlreadyExist') {
                                reject(new TransactionHashAlreadyExistError(`Transaction hash already exists (${result.status.hash.toString()})`))
                            } else {
                                reject(new Error(`Extrinsic failed: ${section}.${method}: ${documentation.join(' ')}`))
                            }
                        } else {
                            reject(new Error(`Extrinsic failed: ${error?.toString() ?? (error as unknown as string)} `))
                        }
                    }

                    resolve(result.status.hash)
                }

                if (result.status.isInvalid) {
                    reject(new Error('Invalid transaction'))
                }
            }).then((unsubscribe) => {
                // comment out the following may help resolving weird error leaking
                promise.finally(() => unsubscribe())
            }).catch((reason) => {
                reject(new Error(`Failed to send extrinsic: ${(reason as Error)?.message ?? reason} `))
            })
        })

        return await promise
    }

    private constructor(api: ApiPromise) {
        this.api = api
    }
}
