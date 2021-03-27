import assert, { AssertionError } from 'assert'
import { NetworkDescription, networks } from '../src/config'
import { EtherscanClient } from '../src/etherscan'

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

async function readTransactions(contractHeight: number, contract: string): Promise<void> {
    let chainHeight = 0
    try {
        chainHeight = await client.readHeight()
        console.info(`Current Ethereum height: ${chainHeight}`)
    } catch (reason) {
        console.error(`readHeight ERROR: ${reason as string}`)
    }

    console.info(`Will read Ethereum transactions from block ${contractHeight} to ${chainHeight}`)

    const iterator = client.readTokenTx(chainHeight, contractHeight, contract)
    let totalBurn = 0
    let totalRaw = 0
    while (true) {
        const result = await iterator.next()

        if (result.done !== false) {
            console.info(`Last block height ${result.value.toString()}`)
            break
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

    console.info(`Read all ${totalBurn} burn of ${totalRaw} raw transactions`)
}

readTransactions(network.contractHeight, network.contract).then(() => { }).catch((reason) => { console.error(reason) })
