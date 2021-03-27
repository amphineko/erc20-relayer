import { AddressOrPair } from '@polkadot/api/types'
import Keyring from '@polkadot/keyring'
import { BalanceOf } from '@polkadot/types/interfaces'
import { AssertionError } from 'assert'
import log from 'loglevel'
import { AgentConfiguration, NetworkDescription } from './config'
import { EtherscanClient } from './etherscan'
import { PhalaClient, TransactionHashAlreadyExistError } from './phala'
import { balanceOf, ethereumAddress, ethereumTxHash } from './phala/data'

/**
 * @param lowBlockNumber starting block to read transactions
 * @param contract contract address of ERC20
 * @param client Etherscan client
 * @returns
 */
async function forwardTransactions(
    startBlock: number, ethHeight: number, contract: string, client: EtherscanClient, alice: AddressOrPair, phala: PhalaClient
): Promise<number> {
    const { debug, info } = log.getLogger('forwardTransactions')

    info(`Reading burn transactions from block ${startBlock} to block ${ethHeight}`)
    const generator = client.readTokenTx(ethHeight, startBlock, contract)

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
            info(` Found transaction ${claim.original.hash} from ${claim.original.from} @ ${claim.amount.toString()}`)
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

async function forwardHistoryTransactions(lastWrittenHeight: number, contractHeight: number, contract: string, client: EtherscanClient, alice: AddressOrPair, phala: PhalaClient): Promise<number> {
    const startBlock = Math.max(lastWrittenHeight, contractHeight) + 1
    const etherHeight = await client.readHeight()
    log.getLogger('forwardHistoryTransactions').debug(`Forward transactions starting from block ${startBlock} to ${etherHeight}`)
    const currentHeight = await forwardTransactions(startBlock, etherHeight, contract, client, alice, phala)
    return Math.min(currentHeight, etherHeight)
}

export async function run(network: NetworkDescription, agent: AgentConfiguration): Promise<void> {
    const ether = new EtherscanClient(agent.etherscanApiKey, network.etherscanApiBase, agent.proxy)
    const phala = await PhalaClient.create(network.endpoint)

    const keyring = new Keyring({ type: 'sr25519' })
    const alice = keyring.addFromUri(agent.alice)

    log.getLogger('run').debug('Clients initialized')

    let lastWrittenHeight = 0
    while (true) {
        lastWrittenHeight = await forwardHistoryTransactions(
            Math.max(lastWrittenHeight, await phala.queryEndHeight()),
            network.contractHeight, network.contract, ether, alice, phala
        )
    }
}
