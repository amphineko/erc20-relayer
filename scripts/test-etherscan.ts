import assert, { AssertionError } from 'assert'
import log from 'loglevel'
import logPrefix from 'loglevel-plugin-prefix'
import { NetworkDescription, networks } from '../src/config'
import { EtherscanClient } from '../src/etherscan'

logPrefix.reg(log)
log.enableAll()

const apiKey = process.env.API_KEY
if (apiKey === undefined) {
    throw new Error('No API key found in environment variables')
}

const networkName = process.env.NETWORK
if (networkName === undefined) {
    throw new Error('No network name found in environment variables')
}

const network: NetworkDescription | undefined = networks[networkName]
if (network === undefined) {
    throw new Error(`Network ${networkName} is not supported`)
}

const client = new EtherscanClient(apiKey, network.etherscanApiBase, process.env.HTTP_PROXY)

async function readTransactions(startHeight: number, contract: string): Promise<{
    burnCount: number
    rawCount: number
    lastBlock: number
}> {
    let chainHeight = 0
    try {
        chainHeight = await client.readHeight()
        console.info(`Current Ethereum height: ${chainHeight}`)
    } catch (reason) {
        console.error(`readHeight ERROR: ${reason as string}`)
    }

    console.info(`Will read Ethereum transactions from block ${startHeight} to ${chainHeight}`)

    const iterator = client.readTokenTx(chainHeight, startHeight, contract)
    let totalBurn = 0
    let totalRaw = 0
    while (true) {
        const result = await iterator.next()

        if (result.done === true) {
            console.info(`Last block height ${result.value.toString()}`)
            console.info(`Read ${totalBurn} burn of ${totalRaw} raw transactions in this window`)

            return {
                rawCount: totalRaw,
                burnCount: totalBurn,
                lastBlock: result.value
            }
        }

        const raw = result.value
        const burn = raw.filter(tx => tx.to === '0x000000000000000000000000000000000000dead')

        const blockNumber = raw[0]?.blockNumber
        if (blockNumber === undefined) {
            throw new AssertionError({ message: 'Unexpected empty block' })
        }

        raw.forEach(tx => {
            assert(tx.blockNumber === blockNumber)
            if (tx.contractAddress !== contract) {
                console.error(`Contract address mismatch (${tx.contractAddress} !== ${network?.contract ?? ''})`)
                throw new AssertionError({
                    actual: tx.contractAddress,
                    expected: network?.contract,
                    message: 'Contract address mismatch'
                })
            }
        })

        burn.forEach(tx => {
            console.info(`${tx.blockNumber},${tx.hash},${tx.from},${tx.value}`)
        })

        console.info(`Read ${burn.length} burn of ${raw.length} raw transactions at ${blockNumber?.toString()}`)

        totalBurn += burn.length
        totalRaw += raw.length
    }
}

async function run(contractHeight: number, contract: string): Promise<void> {
    let totalBurn = 0
    let totalRaw = 0
    let lastBlock = contractHeight

    while (true) {
        const { rawCount: allTxCount, burnCount: burnTxCount, lastBlock: block } = await readTransactions(lastBlock, contract)
        totalBurn += burnTxCount
        totalRaw += allTxCount
        lastBlock = block + 1

        if (allTxCount === 0) break
    }

    console.info(`Session read all ${totalBurn} burn of ${totalRaw} raw transactions`)
}

run(network.contractHeight, network.contract).then(() => { }).catch((reason) => { console.error(reason) })
