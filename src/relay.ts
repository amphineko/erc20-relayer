import { AddressOrPair } from '@polkadot/api/types'
import Keyring from '@polkadot/keyring'
import { BalanceOf } from '@polkadot/types/interfaces'
import { AssertionError } from 'assert'
import log from 'loglevel'
import { AgentConfiguration, NetworkDescription } from './config'
import { EtherscanClient, Transaction } from './etherscan'
import { PhalaClient, TransactionHashAlreadyExistError } from './phala'
import { balanceOf, ethereumAddress, ethereumTxHash } from './phala/data'

/**
 * Retrieve the first transactions with the same block number
 */
function chunkTransactions(input: Transaction[]): Map<string, Transaction[]> {
    const map = new Map<string, Transaction[]>()
    input.forEach(tx => {
        if (map.has(tx.blockNumber)) {
            map.get(tx.blockNumber)?.push(tx)
        } else {
            map.set(tx.blockNumber, [tx])
        }
    })
    return map
}

/**
 * Approximate maximum amount of transactions per block
 */
const maximumTxPerBlock = 300

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

    info(`Reading ERC-20 burn transactions from block ${startBlock} to block ${ethHeight}`)

    // TODO: extract this as a function to retrieve a full block over pages
    // TODO: filter out non-burn destination address
    const allTransactions = (await client.readTokenTxPage(1, maximumTxPerBlock, ethHeight, startBlock, contract))
    // .filter((tx) => {
    //     if (tx.to === '0x000000000000000000000000000000000000dead') {
    //         return true
    //     } else {
    //         console.log(tx.to)
    //         return false
    //     }
    // })

    const chunked = chunkTransactions(allTransactions)
    const blockNumber = Array.from(chunked.keys())
        .map(a => parseInt(a))
        .sort((a, b) => a - b)[0] ?? undefined

    if (blockNumber === undefined) {
        debug(`Retrieved no transactions from block ${startBlock} to block ${ethHeight}`)
        return ethHeight
    }

    info(`Writing ERC-20 burn transactions of block ${blockNumber} to Phala`)

    const claims = chunked.get(blockNumber.toString())?.map((tx) => {
        const hash = ethereumTxHash.encode(tx.hash)
        const address = ethereumAddress.encode(tx.from)
        const amount = balanceOf.encode(tx.value).divn(1e+2) as BalanceOf
        return { address, amount, tx: hash }
    })

    if (claims === undefined) { throw new AssertionError() }

    claims.forEach((claim) => debug(`Writing transaction ${claim.tx.toString()} from ${claim.address.toString()} @ ${claim.amount.toString()}`))

    try {
        await phala.storeErc20BurnedTransaction(blockNumber, claims, alice)
    } catch (error) {
        if (error instanceof TransactionHashAlreadyExistError) {
            debug(`Skipping already existing transactions of block ${blockNumber}`)
        } else {
            throw error
        }
    }

    return blockNumber
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
