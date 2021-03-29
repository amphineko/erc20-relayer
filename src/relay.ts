import { AddressOrPair } from '@polkadot/api/types'
import Keyring from '@polkadot/keyring'
import { BalanceOf } from '@polkadot/types/interfaces'
import { AssertionError } from 'assert'
import log from 'loglevel'
import { AgentConfiguration, NetworkDescription } from './config'
import { EtherscanClient } from './etherscan'
import { PhalaClient, TransactionHashAlreadyExistError } from './phala'
import { balanceOf, ethereumAddress, ethereumTxHash } from './phala/data'

const cooldownTimeout = 1000 * 60

/**
 * @param lowBlockNumber starting block to read transactions
 * @param contract contract address of ERC20
 * @param client Etherscan client
 * @returns
 */
async function relayTransactions(
    topBlock: number, startBlock: number, contract: string, client: EtherscanClient, alice: AddressOrPair, phala: PhalaClient
): Promise<number> {
    const { debug, info } = log.getLogger('relayTransactions')

    info(`Reading burn transactions from block ${startBlock} to block ${topBlock}`)
    const generator = client.readTokenTx(topBlock, startBlock, contract)

    while (true) {
        const result = await generator.next()

        if (result.done === true) {
            return result.value
        }

        if (result.value[0] === undefined) {
            throw new AssertionError({ message: 'readTokenTx returned empty block' })
        }
        const blockNumber = parseInt(result.value[0].blockNumber)

        const burns = result.value
            .filter(tx => tx.to === '0x000000000000000000000000000000000000dead')
            .map(tx => {
                const hash = ethereumTxHash.encode(tx.hash)
                const address = ethereumAddress.encode(tx.from)
                const amount = balanceOf.encode(tx.value).divn(1e+2) as BalanceOf
                return { address, amount, original: tx, tx: hash }
            })
        if (burns.length === 0) { continue }

        info(`In Ethereum block ${result.value[0]?.blockNumber ?? 0}:`)
        burns.forEach((claim) => {
            info(`> ${claim.original.hash} from ${claim.original.from} value ${claim.amount.toString()}`)
        })

        try {
            await phala.storeErc20BurnedTransaction(blockNumber, burns, alice)
        } catch (error) {
            if (error instanceof TransactionHashAlreadyExistError) {
                debug(`Skipping already existing transactions of block ${blockNumber}`)
            } else {
                throw error
            }
        }

        info(`Written ${burns.length} burn transactions of Ethereum block ${blockNumber}`)
    }
}

async function relayTransactions2(
    startBlock: number, contract: string, client: EtherscanClient, alice: AddressOrPair, phala: PhalaClient
): Promise<number> {
    const ethereumHeight = await client.readHeight()
    const currentHeight = await relayTransactions(ethereumHeight, startBlock, contract, client, alice, phala)
    return Math.min(currentHeight, ethereumHeight)
}

export async function run(network: NetworkDescription, agent: AgentConfiguration): Promise<void> {
    const ethereumClient = new EtherscanClient(agent.etherscanApiKey, network.etherscanApiBase, agent.proxy)
    const phalaClient = await PhalaClient.create(network.endpoint)

    const keyring = new Keyring({ type: 'sr25519' })
    const alice = keyring.addFromUri(agent.alice)

    log.getLogger('run').debug('Clients initialized')

    let lastWrittenHeight = 0
    while (true) {
        lastWrittenHeight = await relayTransactions2(
            Math.max(
                lastWrittenHeight + 1,
                await phalaClient.queryEndHeight() + 1,
                network.contractHeight
            ),
            network.contract, ethereumClient, alice, phalaClient
        )

        log.getLogger('run').info(`Cooling down for ${cooldownTimeout / 1000} seconds`)
        await new Promise<void>(resolve => setTimeout(() => resolve(), cooldownTimeout))
    }
}
